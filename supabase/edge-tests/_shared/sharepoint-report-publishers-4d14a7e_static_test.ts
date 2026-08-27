// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/sharepoint-report-publishers-4d14a7e_static_test.ts', import.meta.url).href;
// Phase 4D.14A.7E — Static-contract tests for the six migrated
// direct generated-report SharePoint publishers plus the shared
// publisher. Assert zero active-runtime references to Global
// Microsoft/SharePoint secrets and no local Graph/site helpers.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FORBIDDEN_ACTIVE = [
  'Deno.env.get("M365_',
  'Deno.env.get("BTPM_SP_',
  "login.microsoftonline.com",
  "function getGraphToken(",
  "function graphFetch(",
  "function resolveSiteId(",
  "function resolveProjectFolder(",
  "function resolveLibraryRoot(",
  "function resolveDefaultLibraryRoot(",
  // Bare identifier references to retired constants.
  "M365_TENANT_ID",
  "M365_CLIENT_ID",
  "M365_CLIENT_SECRET",
  "BTPM_SP_SITE_URL",
  "BTPM_SP_SITE_ID",
];

const FILES = [
  new URL("../generate-project-charter/index.ts", __BTPM_SRC_BASE__),
  new URL("../generate-project-closure-report/index.ts", __BTPM_SRC_BASE__),
  new URL("../generate-decision-case-word-brief/index.ts", __BTPM_SRC_BASE__),
  new URL("../generate-decision-case-ppt-onepager/index.ts", __BTPM_SRC_BASE__),
  new URL("../generate-project-status-deck/index.ts", __BTPM_SRC_BASE__),
  new URL("../generate-roadmap-status-deck/index.ts", __BTPM_SRC_BASE__),
  new URL("./sharePointGeneratedDocumentPublisher.ts", __BTPM_SRC_BASE__),
];

async function readWithoutComments(url: URL): Promise<string> {
  const raw = await Deno.readTextFile(url);
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
}

for (const url of FILES) {
  const label = url.pathname.split("/").slice(-2).join("/");
  Deno.test(`4D.14A.7E: ${label} — no active Global secrets / local Graph helpers`, async () => {
    const src = await readWithoutComments(url);
    for (const needle of FORBIDDEN_ACTIVE) {
      assert(
        !src.includes(needle),
        `${label} still contains forbidden active-runtime reference: ${needle}`,
      );
    }
  });
}

Deno.test("4D.14A.7E: shared publisher uses canonical Tenant runtime + Graph resolver", async () => {
  const url = new URL("./sharePointGeneratedDocumentPublisher.ts", __BTPM_SRC_BASE__);
  const src = await Deno.readTextFile(url);
  assert(src.includes("resolveTenantSharePointRuntimeConfig"), "missing SharePoint runtime resolver");
  assert(src.includes("resolveAndAcquireTenantMicrosoftGraph"), "missing Graph runtime resolver");
  assert(src.includes("resolveSharePointProjectRoot"), "missing project-root resolver");
  assert(src.includes("resolveSharePointWorkspaceLibraryRoot"), "missing workspace-root resolver");
  assert(src.includes("getSharePointSiteDefaultDrive"), "missing default-drive helper");
  assert(src.includes("uploadSharePointFileBytes"), "missing upload transport");
});

Deno.test("4D.14A.7E: project reports import shared publisher", async () => {
  const paths = [
    "../generate-project-charter/index.ts",
    "../generate-project-closure-report/index.ts",
    "../generate-decision-case-word-brief/index.ts",
    "../generate-decision-case-ppt-onepager/index.ts",
    "../generate-project-status-deck/index.ts",
  ];
  for (const p of paths) {
    const src = await Deno.readTextFile(new URL(p, __BTPM_SRC_BASE__));
    assert(
      src.includes("sharePointGeneratedDocumentPublisher"),
      `${p} does not import shared publisher`,
    );
    assert(
      src.includes("createTenantSharePointPublishSession"),
      `${p} does not create a publish session`,
    );
    assert(
      src.includes("resolveProjectDocumentPublishTarget"),
      `${p} does not resolve a project target`,
    );
    assert(
      src.includes("publishGeneratedDocumentBytes"),
      `${p} does not upload via the shared publisher`,
    );
    // Authority proven before runtime resolution — compare the LAST
    // occurrence of each identifier so the import statement (for the
    // session helper) is not confused with the actual call site.
    const authIdx = src.lastIndexOf("has_project_pm_authority");
    const sessionIdx = src.lastIndexOf("createTenantSharePointPublishSession");
    assert(authIdx > 0 && sessionIdx > 0 && authIdx < sessionIdx, `${p}: authority must precede runtime`);
  }
});

Deno.test("4D.14A.7E: Roadmap deck imports shared publisher + workspace/default targets", async () => {
  const src = await Deno.readTextFile(
    new URL("../generate-roadmap-status-deck/index.ts", __BTPM_SRC_BASE__),
  );
  assert(src.includes("resolveWorkspaceDocumentPublishTarget"));
  assert(src.includes("resolveDefaultSiteDocumentPublishTarget"));
  assert(src.includes("cross_organization_scope_not_supported"));
  // Authority proven before runtime resolution (skip the import line
  // via `lastIndexOf`).
  const accessIdx = src.lastIndexOf("has_project_access");
  const sessionIdx = src.lastIndexOf("createTenantSharePointPublishSession");
  assert(accessIdx > 0 && sessionIdx > 0 && accessIdx < sessionIdx);
});
