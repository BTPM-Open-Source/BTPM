/**
 * API-Q Cross-Family-C20C16 — static/contract test.
 *
 * Proves the Decision Data Package ZIP bundle generator follows the accepted
 * C20C15/C20C7 authority ordering: browser-session guard → authenticated
 * caller → request validation → caller-scoped protected Decision Case
 * resolution → caller-scoped Project write authority → service-role client
 * → existing authorized bundle assembly / Graph / storage / persistence.
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN = "supabase/functions/generate-decision-case-data-package-bundle/index.ts";
const src = await Deno.readTextFile(FN);

const ix = (needle: string) => src.indexOf(needle);

const I_GUARD = ix("assertBrowserSessionOnly(req, verifier)");
const I_GETUSER = ix("await userClient.auth.getUser()");
const I_VALIDATE = ix('error: "invalid_request"');
const I_SUMMARY = ix('"get_governance_decision_case_project_summary"');
const I_WRITE = ix('"_gov_assert_project_write"');
const I_ADMIN = ix("createClient(SUPABASE_URL, SERVICE_ROLE)");

Deno.test("C20C16-2: browser-session guard remains present", () => {
  assert(src.includes("assertBrowserSessionOnly"), "guard present");
  assert(src.includes("createSupabaseTokenVerifier(userClient)"), "caller-scoped verifier");
  assert(I_GUARD > 0);
});

Deno.test("C20C16-3: guard precedes getUser and all business work", () => {
  assert(I_GUARD < I_GETUSER);
  assert(I_GUARD < I_SUMMARY);
  assert(I_GUARD < I_ADMIN);
});

Deno.test("C20C16-4/5: getUser then recordId validation precede protected summary", () => {
  assert(I_GETUSER < I_VALIDATE, "auth before validation");
  assert(I_VALIDATE < I_SUMMARY, "validation before resolution");
});

Deno.test("C20C16-6/7/8/9: caller-scoped summary → caller-scoped write authority", () => {
  assert(
    /userClient\.rpc\(\s*\n?\s*"get_governance_decision_case_project_summary"/.test(src),
    "summary RPC on caller client",
  );
  assert(!/admin\.rpc\(\s*\n?\s*"get_governance_decision_case_project_summary"/.test(src));
  assert(I_SUMMARY < I_WRITE, "summary before authority");
  assert(/userClient\.rpc\("_gov_assert_project_write"/.test(src), "authority caller-scoped");
  assert(!src.includes("_gov_assert_project_read"), "authority not weakened to read");
});

Deno.test("C20C16-10/11: authority precedes single service-role construction", () => {
  assert(I_SUMMARY < I_ADMIN);
  assert(I_WRITE < I_ADMIN);
  assert(src.split("createClient(SUPABASE_URL, SERVICE_ROLE)").length - 1 === 1);
});

Deno.test("C20C16-12/13/14: old admin authority path removed", () => {
  assert(!src.includes('.from("governance_records")'), "no admin governance_records lookup");
  assert(!src.includes("record_kind"), "no direct record_kind inspection");
  assert(!src.includes("has_project_pm_authority"), "old PM authority path removed");
  assert(!src.includes('error: "record_lookup_failed"'));
  assert(!src.includes('error: "authority_check_failed"'));
});

Deno.test("C20C16-15/16: scope from protected summary; no duplicate summary call", () => {
  assert(src.includes("const projectId: string | undefined = summary?.project_id"));
  assert(src.includes("const organizationId: string | undefined = summary?.organization_id"));
  assert(src.includes("const workspaceId: string | undefined = summary?.workspace_id"));
  assert(
    src.split('"get_governance_decision_case_project_summary"').length - 1 === 1,
    "exactly one summary call",
  );
  assert(!src.includes("summaryRes"), "later duplicate summary result removed");
});

Deno.test("C20C16-17/18/19: canonical protected RPCs remain caller-scoped", () => {
  for (
    const rpc of [
      "get_governance_record_detail",
      "list_governance_record_evidence_references",
      "list_governance_record_btpm_context_links",
      "list_governance_record_stakeholder_packages",
      "get_governance_record_decision_outcome",
      "list_project_stakeholders",
      "list_governance_record_evidence_files",
      "list_governance_record_brief_versions",
      "list_decision_case_ai_runs",
    ]
  ) {
    assert(new RegExp(`userClient\\.rpc\\("${rpc}"`).test(src), `${rpc} caller-scoped`);
    assert(!new RegExp(`admin\\.rpc\\("${rpc}"`).test(src), `${rpc} not admin`);
  }
});

Deno.test("C20C16-cross-project containment preserved", () => {
  assert(src.includes("const sourceProjectIdSet = new Set<string>([projectId])"));
  assert(src.includes("if (l?.source_project_id) sourceProjectIdSet.add(l.source_project_id)"));
});

Deno.test("C20C16-20/21: Graph runtime and evidence downloads occur after authority", () => {
  const graph = src.indexOf("resolveAndAcquireTenantMicrosoftGraph(");
  assert(graph > I_WRITE, "graph runtime after authority");
  const dl = src.indexOf("downloadMicrosoftGraphDriveItemBytes(");
  assert(dl > I_WRITE, "evidence download after authority");
  assert(src.includes("toSafeGraphRuntimeFilePublicError"), "safe graph errors retained");
});

Deno.test("C20C16-22: AI run-file / generated-document admin reads after authority", () => {
  const a = src.indexOf('admin.from("decision_case_ai_run_files")');
  const b = src.indexOf('admin.from("generated_operational_documents")');
  assert(a > I_WRITE && b > I_WRITE);
});

Deno.test("C20C16-23/24/25/26: storage, limits and ZIP behavior unchanged", () => {
  assert(src.includes('const BUNDLE_BUCKET = "btpm-exports"'));
  assert(src.includes("const MAX_FILES = 50"));
  assert(src.includes("const MAX_FILE_BYTES = 25 * 1024 * 1024"));
  assert(src.includes("const MAX_TOTAL_BYTES = 75 * 1024 * 1024"));
  assert(src.includes("`${userId}/decision-case-bundles/${packageId}/bundle.zip`"));
  assert(src.includes("zipSync("));
  assert(src.includes("sha256Hex("));
  assert(src.includes('contentType: "application/zip"'));
  assert(src.includes("upsert: false"));
});

Deno.test("C20C16-27/28/29/30: versioning, persistence and cleanup unchanged", () => {
  assert(src.includes("version_number") && src.includes("nextVersion"));
  assert(src.includes('package_status: "superseded"'));
  assert(src.includes('package_status: "prepared"'));
  assert(src.includes("is_current: true"));
  assert(src.includes('package_format: "zip_bundle"'));
  assert(src.includes("source_project_ids: sourceProjectIds"));
  assert(src.includes("created_by: userId"));
  assert(src.includes(".remove([storagePath])"), "uploaded object removed on insert failure");
});

Deno.test("C20C16-31: encryption remains trigger-based", () => {
  assert(!src.includes("btpm_encrypt"), "no manual encryption");
  assert(src.includes("package_json:"));
  assert(src.includes("package_filename:"));
  assert(src.includes("bundle_filename:"));
});

Deno.test("C20C16-32/33: activity event unchanged and free of plaintext", () => {
  assert(src.includes('_event_type: "governance_record_copilot_data_package_bundle_generated"'));
  for (
    const k of [
      "project_id: projectId",
      "data_package_id:",
      "version_number: nextVersion",
      "package_hash:",
      "bundle_hash:",
      "bundle_status:",
      "bundle_size_bytes:",
      "packaged_file_count:",
      "failed_file_count:",
    ]
  ) assert(src.includes(k), `${k} retained`);
  const metaStart = src.indexOf("_metadata: {", src.indexOf("bundle_generated"));
  const metaBlock = src.slice(metaStart, metaStart + 500);
  assert(!metaBlock.includes("package_json"));
  assert(!metaBlock.includes("evidence_summary"));
  assert(src.includes("_user_id: userId"), "authenticated caller is actor");
});

Deno.test("C20C16-34: no bypass language introduced", () => {
  for (
    const forbidden of [
      "source_channel",
      "trusted_context",
      "connected_app",
      "mcp_",
      "client_credentials",
      "service_role_bypass",
    ]
  ) assert(!src.toLowerCase().includes(forbidden), `must not reference ${forbidden}`);
});

Deno.test("C20C16-19b: error vocabulary preserved", () => {
  for (
    const e of [
      "missing_authorization",
      "not_authenticated",
      "invalid_request",
      "record_not_found",
      "not_decision_case",
      "not_authorized",
      "data_assembly_failed",
      "zip_build_failed",
      "bundle_upload_failed",
      "insert_failed",
      "unhandled",
    ]
  ) assert(src.includes(`"${e}"`), `${e} preserved`);
});

Deno.test("C20C16-1/35/36: adjacent surfaces untouched", async () => {
  const svc = await Deno.readTextFile("src/lib/decisionCaseDataPackageService.ts");
  assert(svc.includes('"generate-decision-case-data-package-bundle"'));
  assert(svc.includes("export async function generateDecisionCaseDataPackageBundle"));
  const hook = await Deno.readTextFile("src/hooks/useGovernanceCopilotDataPackages.ts");
  assert(hook.includes("generateDecisionCaseDataPackageBundle(recordId)"));
  const dl = await Deno.readTextFile(
    "supabase/functions/get-decision-case-data-package-bundle-download-url/index.ts",
  );
  assert(dl.length > 0, "signed-URL function still present");
  const jsonGen = await Deno.readTextFile(
    "supabase/functions/generate-decision-case-data-package/index.ts",
  );
  assert(jsonGen.includes("assertBrowserSessionOnly"), "JSON generator untouched");
});

Deno.test("C20C16-37: unrelated dataQualityNotes declaration defect NOT claimed fixed", () => {
  // Out of scope for C20C16: usage still precedes declaration.
  const firstUse = src.indexOf("dataQualityNotes.push(");
  const decl = src.indexOf("const dataQualityNotes: string[] = []");
  assert(firstUse > 0 && decl > 0);
  assert(firstUse < decl, "pre-existing ordering defect intentionally left unchanged");
});
