/**
 * API-Q Cross-Family-C20C17 — static/contract test.
 *
 * Proves the Decision Data Package bundle signed-download function follows the
 * accepted C20 Edge ordering: browser-session guard → authenticated caller →
 * request validation → caller-scoped protected Decision Case resolution →
 * caller-scoped Project READ authority → service-role client → package lookup
 * → scope correlation → source-project READ authority → bundle state →
 * filename decrypt → signed URL → download metadata.
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN = "supabase/functions/get-decision-case-data-package-bundle-download-url/index.ts";
const src = await Deno.readTextFile(FN);
const ix = (n: string) => src.indexOf(n);

const I_GUARD = ix("assertBrowserSessionOnly(req, verifier)");
const I_GETUSER = ix("await userClient.auth.getUser()");
const I_VALIDATE = ix('error: "invalid_request"');
const I_SUMMARY = ix('"get_governance_decision_case_project_summary"');
const I_READ = ix('_gov_assert_project_read');
const I_ADMIN = ix("createClient(SUPABASE_URL, SERVICE_ROLE)");
const I_PKG = ix('.from("governance_record_copilot_data_packages")');
const I_CORR = ix("p.governance_record_id !== recordId");
const I_SOURCE = ix("for (const sp of sourceIds)");
const I_FORMAT = ix('p.package_format !== "zip_bundle"');
const I_DECRYPT = ix('admin.rpc("btpm_decrypt"');
const I_SIGN = ix(".createSignedUrl(");

Deno.test("C20C17-4/5/6: guard present, precedes getUser and business work", () => {
  assert(src.includes("assertBrowserSessionOnly"));
  assert(src.includes("createSupabaseTokenVerifier(userClient)"));
  assert(src.includes("toSafeErrorResponse"));
  assert(I_GUARD > 0 && I_GUARD < I_GETUSER);
  assert(I_GETUSER < I_VALIDATE && I_VALIDATE < I_SUMMARY);
});

Deno.test("C20C17-7: both recordId and packageId validated", () => {
  assert(src.includes('note: "recordId required"'));
  assert(src.includes('note: "packageId required"'));
});

Deno.test("C20C17-8/9: protected summary caller-scoped, before service role", () => {
  assert(
    /userClient\.rpc\(\s*\n?\s*"get_governance_decision_case_project_summary"/.test(src),
  );
  assert(!/admin\.rpc\(\s*\n?\s*"get_governance_decision_case_project_summary"/.test(src));
  assert(I_SUMMARY < I_ADMIN);
  assert(src.includes('error: "record_not_found"'));
  assert(src.includes('error: "not_decision_case"'));
});

Deno.test("C20C17-10/11/12/13: caller-scoped READ authority before single admin client", () => {
  assert(/userClient\.rpc\("_gov_assert_project_read"/.test(src));
  assert(!src.includes("_gov_assert_project_write"), "READ not WRITE");
  assert(!src.includes("has_project_pm_authority"));
  assert(I_SUMMARY < I_READ && I_READ < I_ADMIN);
  assert(src.split("createClient(SUPABASE_URL, SERVICE_ROLE)").length - 1 === 1);
});

Deno.test("C20C17-14/15/21: removed old admin lookups and access loop", () => {
  assert(!src.includes('.from("governance_records")'));
  assert(!src.includes("record_kind"));
  assert(!src.includes("has_project_access"));
  assert(!src.includes("parent_record_not_found"));
  assert(!src.includes("access_check_failed"));
});

Deno.test("C20C17-16/17/18/19: package lookup after authority, correlated on full scope", () => {
  assert(I_READ < I_PKG && I_ADMIN < I_PKG);
  assert(src.includes("id, organization_id, workspace_id, project_id, governance_record_id, "));
  assert(I_PKG < I_CORR);
  for (
    const c of [
      "p.governance_record_id !== recordId",
      "p.project_id !== projectId",
      "p.organization_id !== organizationId",
      "p.workspace_id !== workspaceId",
    ]
  ) assert(src.includes(c), `${c} correlated`);
  const mismatch = src.slice(I_CORR, I_CORR + 400);
  assert(mismatch.includes('error: "package_not_found"'), "non-disclosing mismatch");
});

Deno.test("C20C17-20/22/23/24: source assertions caller-scoped and before state/decrypt/sign", () => {
  assert(src.includes('userClient.rpc("_gov_assert_project_read", {\n        _project_id: sp,'));
  assert(src.includes('error: "not_authorized_source_project"'));
  assert(I_CORR < I_SOURCE);
  assert(I_SOURCE < I_FORMAT);
  assert(I_SOURCE < I_DECRYPT);
  assert(I_SOURCE < I_SIGN);
});

Deno.test("C20C17-25/26/27/28: bundle state and decrypt behavior unchanged", () => {
  assert(src.includes('error: "not_a_zip_bundle"'));
  assert(src.includes('["generated", "partial"].includes(p.bundle_status)'));
  assert(src.includes('error: "bundle_not_available"'));
  assert(src.includes('error: "bundle_storage_missing"'));
  assert(src.includes('_ciphertext: encryptedFilename'));
  assert(src.includes('"decision-data-bundle.zip"'));
  assert(I_READ < I_DECRYPT);
});

Deno.test("C20C17-29/30: signed URL contract unchanged", () => {
  assert(src.includes("const expiresIn = 300"));
  assert(src.includes("download: safeFilename"));
  assert(src.includes('error: "signed_url_failed"'));
  assert(src.includes('expires_in_seconds: expiresIn'));
  assert(!src.includes("bundle_storage_path: "), "no storage path returned");
});

Deno.test("C20C17-31/32/33: metadata update limited; no activity event", () => {
  assert(
    src.includes("{ bundle_downloaded_at: nowIso, bundle_downloaded_by: userId }"),
  );
  assert(!src.includes("log_project_activity"));
  assert(!src.includes("_event_type"));
  assert(!src.includes("package_status:"));
  assert(!src.includes("is_current:"));
});

Deno.test("C20C17-34/35: no schema change, no bypass language", () => {
  assert(!src.includes("btpm_encrypt"));
  for (
    const f of [
      "source_channel",
      "trusted_context",
      "connected_app",
      "mcp_",
      "client_credentials",
      "service_role_bypass",
      "capability",
    ]
  ) assert(!src.toLowerCase().includes(f), `must not reference ${f}`);
});

Deno.test("C20C17-19b: error vocabulary", () => {
  for (
    const e of [
      "missing_authorization",
      "not_authenticated",
      "invalid_request",
      "package_not_found",
      "record_not_found",
      "not_decision_case",
      "not_authorized",
      "not_authorized_source_project",
      "not_a_zip_bundle",
      "bundle_not_available",
      "bundle_storage_missing",
      "decrypt_failed",
      "signed_url_failed",
      "unhandled",
    ]
  ) assert(src.includes(`"${e}"`), `${e} preserved`);
});

Deno.test("C20C17-1/2/36/37/38: service + hook recordId propagation only", async () => {
  const svc = await Deno.readTextFile("src/lib/decisionCaseDataPackageService.ts");
  assert(svc.includes("body: { recordId, packageId }"));
  assert(
    svc.includes(
      "export async function getDecisionCaseDataPackageBundleDownloadUrl(\n  recordId: string,\n  packageId: string,\n)",
    ),
  );
  assert(svc.includes("DataPackageBundleSignedUrlResult"));
  const hook = await Deno.readTextFile("src/hooks/useGovernanceCopilotDataPackages.ts");
  assert(hook.includes("useGetGovernanceRecordCopilotDataPackageBundleDownloadUrl(\n  recordId: string,\n)"));
  assert(hook.includes("mutationFn: async (packageId: string) =>"));
  assert(hook.includes("getDecisionCaseDataPackageBundleDownloadUrl(recordId, packageId)"));

  // No other caller left broken.
  // In-process, read-only search: no subprocess, so the canonical MCP
  // regression suite needs no `--allow-run` permission.
  async function filesReferencing(symbol: string, root: string): Promise<string[]> {
    const hits: string[] = [];
    for await (const entry of Deno.readDir(root)) {
      const path = `${root}/${entry.name}`;
      if (entry.isDirectory) {
        hits.push(...(await filesReferencing(symbol, path)));
        continue;
      }
      if (!entry.isFile) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if ((await Deno.readTextFile(path)).includes(symbol)) hits.push(path);
    }
    return hits;
  }
  const out =
    (await filesReferencing("getDecisionCaseDataPackageBundleDownloadUrl", "src")).sort();
  assert(
    out.join(",") ===
      ["src/hooks/useGovernanceCopilotDataPackages.ts", "src/lib/decisionCaseDataPackageService.ts"]
        .join(","),
    `unexpected callers: ${out.join(",")}`,
  );
});

Deno.test("C20C17-3: adjacent backend surfaces untouched", async () => {
  const bundleGen = await Deno.readTextFile(
    "supabase/functions/generate-decision-case-data-package-bundle/index.ts",
  );
  assert(bundleGen.includes('userClient.rpc("_gov_assert_project_write"'));
  const jsonGen = await Deno.readTextFile(
    "supabase/functions/generate-decision-case-data-package/index.ts",
  );
  assert(jsonGen.includes("assertBrowserSessionOnly"));
});
