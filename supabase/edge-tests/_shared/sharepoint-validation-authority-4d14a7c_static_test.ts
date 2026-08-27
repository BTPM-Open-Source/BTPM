// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/sharepoint-validation-authority-4d14a7c_static_test.ts', import.meta.url).href;
// Phase 4D.14A.7C.1 — Static contract tests for sharepoint-validate authority
// ordering, safe error surface, and absence of Global Microsoft/SharePoint
// runtime references. No live Microsoft, Supabase, or Vault calls.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../sharepoint-validate/index.ts", __BTPM_SRC_BASE__),
);
const SHARED = await Deno.readTextFile(
  new URL("./sharePointBindingValidation.ts", __BTPM_SRC_BASE__),
);

// Strip line comments so we don't false-positive on commentary mentioning
// retired identifiers.
function stripComments(src: string): string {
  return src
    .split("\n")
    .map((l) => (l.trim().startsWith("//") ? "" : l))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const SRC_CODE = stripComments(SRC);
const SHARED_CODE = stripComments(SHARED);

function indexOfOrFail(hay: string, needle: string, label: string): number {
  const idx = hay.indexOf(needle);
  assert(idx >= 0, `expected to find ${label}: ${needle}`);
  return idx;
}

// ---------- Authority precedes runtime / Graph / persistence ----------

Deno.test("validate_workspace_binding proves is_org_admin before Tenant runtime + Graph", () => {
  const handler = SRC_CODE.split("async function handleValidateWorkspaceBinding")[1];
  assert(handler, "handler must exist");
  const authorityIdx = indexOfOrFail(handler, "assertOrgAdmin", "workspace org-admin gate");
  const runtimeIdx = indexOfOrFail(handler, "resolveTenantSharePointRuntimeConfig", "runtime call");
  const graphIdx = indexOfOrFail(handler, "resolveAndAcquireTenantMicrosoftGraph", "graph token");
  const persistIdx = indexOfOrFail(handler, "persistWorkspace", "persistence call");
  assert(authorityIdx < runtimeIdx, "authority must precede runtime resolution");
  assert(authorityIdx < graphIdx, "authority must precede Graph token acquisition");
  assert(authorityIdx < persistIdx, "authority must precede persistence");
});

Deno.test("validate_project_binding proves has_project_pm_authority before runtime + Graph", () => {
  const handler = SRC_CODE.split("async function handleValidateProjectBinding")[1];
  assert(handler, "handler must exist");
  const authorityIdx = indexOfOrFail(handler, "assertProjectPmAuthority", "project PM gate");
  const runtimeIdx = indexOfOrFail(handler, "resolveTenantSharePointRuntimeConfig", "runtime call");
  const graphIdx = indexOfOrFail(handler, "resolveAndAcquireTenantMicrosoftGraph", "graph token");
  const persistIdx = indexOfOrFail(handler, "persistProject", "persistence call");
  assert(authorityIdx < runtimeIdx, "authority must precede runtime resolution");
  assert(authorityIdx < graphIdx, "authority must precede Graph token acquisition");
  assert(authorityIdx < persistIdx, "authority must precede persistence");
});

Deno.test("diagnose_workspace_binding proves workspace admin before runtime + Graph", () => {
  const handler = SRC_CODE.split("async function handleDiagnoseWorkspaceBinding")[1];
  assert(handler, "handler must exist");
  const authorityIdx = indexOfOrFail(handler, "assertWorkspaceAdminOrHigher", "workspace admin gate");
  const runtimeIdx = indexOfOrFail(handler, "resolveTenantSharePointRuntimeConfig", "runtime call");
  const graphIdx = indexOfOrFail(handler, "resolveAndAcquireTenantMicrosoftGraph", "graph token");
  assert(authorityIdx < runtimeIdx, "authority must precede runtime resolution");
  assert(authorityIdx < graphIdx, "authority must precede Graph token acquisition");
});

Deno.test("validate_org_site_connection proves org-admin before runtime + Graph + persistence", () => {
  const handler = SRC_CODE.split("async function handleValidateOrgSite")[1];
  assert(handler, "handler must exist");
  const authorityIdx = indexOfOrFail(handler, "assertOrgAdmin", "org-admin gate");
  const runtimeIdx = indexOfOrFail(handler, "resolveTenantSharePointRuntimeConfig", "runtime call");
  const graphIdx = indexOfOrFail(handler, "resolveAndAcquireTenantMicrosoftGraph", "graph token");
  const persistIdx = indexOfOrFail(handler, "persistOrgSite(adminClient", "persistence call via admin client");
  assert(authorityIdx < runtimeIdx, "authority must precede runtime resolution");
  assert(authorityIdx < graphIdx, "authority must precede Graph token acquisition");
  assert(authorityIdx < persistIdx, "authority must precede persistence");
});

// ---------- Org-site persistence uses adminClient only ----------

Deno.test("persistOrgSite is only invoked with adminClient", () => {
  const call = /persistOrgSite\(\s*(\w+)\s*,/g;
  let m: RegExpExecArray | null;
  const clients = new Set<string>();
  while ((m = call.exec(SRC_CODE)) !== null) clients.add(m[1]);
  assert(clients.size > 0, "persistOrgSite must be invoked");
  for (const c of clients) {
    assert(c === "adminClient", `persistOrgSite must use adminClient, got: ${c}`);
  }
});

Deno.test("callerClient is never passed to persistOrgSite or apply_org_site_validation", () => {
  assert(
    !/persistOrgSite\(\s*callerClient/.test(SRC_CODE),
    "persistOrgSite must never receive callerClient",
  );
  assert(
    !/callerClient\.rpc\(\s*["']apply_org_site_validation["']/.test(SRC_CODE),
    "callerClient must never invoke apply_org_site_validation",
  );
});

// ---------- Safe error responses ----------

Deno.test("forbidden helper returns fixed safe body", () => {
  assert(SRC_CODE.includes(`error: "Not authorized"`), "SAFE_FORBIDDEN body missing");
  assert(SRC_CODE.includes("function forbidden("), "forbidden helper missing");
});

Deno.test("unknown action returns fixed safe message and does not echo client input", () => {
  assert(
    SRC_CODE.includes(`"Unsupported SharePoint validation action."`),
    "unknown-action fixed response missing",
  );
  assert(
    !/Unknown action: \$\{action\}/.test(SRC_CODE),
    "must not echo caller-supplied action string",
  );
});

// ---------- No Global Microsoft/SharePoint runtime reads ----------

Deno.test("sharepoint-validate has zero active Global M365_* / BTPM_SP_* references", () => {
  const banned = [
    'Deno.env.get("M365_',
    'Deno.env.get("BTPM_SP_',
    "M365_TENANT_ID",
    "M365_CLIENT_ID",
    "M365_CLIENT_SECRET",
    "BTPM_SP_SITE_URL",
    "BTPM_SP_SITE_ID",
  ];
  for (const term of banned) {
    assert(
      !SRC_CODE.includes(term),
      `sharepoint-validate must not read ${term} at runtime`,
    );
    assert(
      !SHARED_CODE.includes(term),
      `sharePointBindingValidation must not read ${term} at runtime`,
    );
  }
});

Deno.test("sharepoint-validate has no local Graph token acquirer", () => {
  assert(!/getGraphToken\s*\(/.test(SRC_CODE), "no local getGraphToken");
  assert(
    !SRC_CODE.includes("login.microsoftonline.com"),
    "no direct Microsoft token endpoint",
  );
});
