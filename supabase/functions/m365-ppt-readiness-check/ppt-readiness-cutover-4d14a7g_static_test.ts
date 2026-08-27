// Phase 4D.14A.7G — Static contract tests for the PPT readiness Tenant
// runtime cutover.
//
// Asserts:
//   - No active-runtime references to retired Global Microsoft/SharePoint
//     configuration, local Graph transport helpers, or direct Graph URLs.
//   - Uses canonical Tenant runtime primitives.
//   - Authority + containment ordering: PM authority precedes Tenant
//     runtime resolution and no `profiles.organization_id` is used.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FORBIDDEN_ACTIVE = [
  'Deno.env.get("M365_',
  'Deno.env.get("BTPM_SP_',
  "M365_TENANT_ID",
  "M365_CLIENT_ID",
  "M365_CLIENT_SECRET",
  "BTPM_SP_SITE_URL",
  "BTPM_SP_SITE_ID",
  "login.microsoftonline.com",
  "graph.microsoft.com/v1.0",
  "function getGraphToken(",
  "function graphFetch(",
  "function resolveSiteId(",
  "function resolveProjectFolder(",
  "normalizeGraphResponse",
  "profiles.organization_id",
];

const REQUIRED_PRIMITIVES = [
  "createTenantSharePointPublishSession",
  "resolveProjectDocumentPublishTarget",
  "publishGeneratedDocumentBytes",
  '"publish_ppt_readiness_diagnostic"',
  "has_project_pm_authority",
  '"ppt-readiness-diagnostic-publish"',
];

async function readActive(url: URL): Promise<string> {
  const raw = await Deno.readTextFile(url);
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
}

const INDEX_URL = new URL("./index.ts", import.meta.url);

Deno.test("4D.14A.7G: PPT readiness has no active Global / legacy references", async () => {
  const src = await readActive(INDEX_URL);
  for (const needle of FORBIDDEN_ACTIVE) {
    assert(
      !src.includes(needle),
      `PPT readiness still contains forbidden active-runtime reference: ${needle}`,
    );
  }
});

Deno.test("4D.14A.7G: PPT readiness wires Tenant runtime primitives", async () => {
  const src = await readActive(INDEX_URL);
  for (const needle of REQUIRED_PRIMITIVES) {
    assert(src.includes(needle), `PPT readiness missing required primitive: ${needle}`);
  }
});

Deno.test("4D.14A.7G: authority precedes Tenant runtime session", async () => {
  const src = await readActive(INDEX_URL);
  const authIdx = src.lastIndexOf("has_project_pm_authority");
  const sessionIdx = src.lastIndexOf("createTenantSharePointPublishSession");
  assert(authIdx > 0 && sessionIdx > authIdx, "PM authority must precede Tenant session");
});

Deno.test("4D.14A.7G: uses projects.organization_id as authoritative source", async () => {
  const src = await readActive(INDEX_URL);
  assert(src.includes("organization_id"));
  assert(src.includes("from(\"projects\")") || src.includes(".from('projects')"));
});

Deno.test("4D.14A.7G: preserves all eight stage names + deterministic filename", async () => {
  const src = await readActive(INDEX_URL);
  for (
    const stage of [
      "auth_ok",
      "authority_ok",
      "workspace_binding_ok",
      "project_binding_ok",
      "graph_token_ok",
      "folder_resolved_ok",
      "pptx_generated_ok",
      "upload_ok",
    ]
  ) {
    assert(src.includes(stage), `missing stage: ${stage}`);
  }
  assert(src.includes("BTPM PPT Readiness Check.pptx"));
  assert(
    src.includes(
      '"application/vnd.openxmlformats-officedocument.presentationml.presentation"',
    ),
  );
  assert(src.includes('conflictBehavior: "replace"'));
});

Deno.test("4D.14A.7G: PPTX generation exception maps to safe fixed note", async () => {
  const src = await readActive(INDEX_URL);
  assert(src.includes('"pptx_generation_failed"'));
  assert(src.includes("The diagnostic PowerPoint file could not be generated."));
});

Deno.test("4D.14A.7G: sharePointClient allows publish_ppt_readiness_diagnostic operation", async () => {
  const src = await Deno.readTextFile(
    new URL("../_shared/sharePointClient.ts", import.meta.url),
  );
  assert(src.includes('"publish_ppt_readiness_diagnostic"'));
});
