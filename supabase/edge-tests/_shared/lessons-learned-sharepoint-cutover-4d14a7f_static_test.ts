// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/lessons-learned-sharepoint-cutover-4d14a7f_static_test.ts', import.meta.url).href;
// Phase 4D.14A.7F — Static contract tests for the Lessons Learned Tenant
// runtime cutover.
//
// Asserts:
//   - The two migrated Edge Functions + the new helper contain zero
//     active-runtime references to retired Global Microsoft/SharePoint
//     configuration or local Graph transport helpers.
//   - The legacy `lessons-learned-graph.ts` file no longer exists.
//   - No active source file imports the legacy helper.
//   - The migrated functions use the canonical Tenant runtime primitives.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FORBIDDEN_ACTIVE = [
  'Deno.env.get("M365_',
  'Deno.env.get("BTPM_SP_',
  "login.microsoftonline.com",
  "function getGraphToken(",
  "function graphFetch(",
  "function resolveSiteId(",
  "function resolveProjectFolder(",
  "SHAREPOINT_LESSONS_LEARNED_TEMPLATE_DRIVE_ID",
  "SHAREPOINT_LESSONS_LEARNED_TEMPLATE_ITEM_ID",
  "M365_TENANT_ID",
  "M365_CLIENT_ID",
  "M365_CLIENT_SECRET",
  "BTPM_SP_SITE_URL",
  "BTPM_SP_SITE_ID",
  // Legacy template-copy / polling
  "/copy",
  "copyTemplateIntoFolder",
];

const FILES = [
  new URL("../create-project-lessons-learned-document/index.ts", __BTPM_SRC_BASE__),
  new URL("../refresh-project-lessons-learned-document-metadata/index.ts", __BTPM_SRC_BASE__),
  new URL("./lessonsLearnedSharePoint.ts", __BTPM_SRC_BASE__),
];

async function readWithoutComments(url: URL): Promise<string> {
  const raw = await Deno.readTextFile(url);
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
}

for (const url of FILES) {
  const label = url.pathname.split("/").slice(-2).join("/");
  Deno.test(`4D.14A.7F: ${label} — no active Global / legacy references`, async () => {
    const src = await readWithoutComments(url);
    for (const needle of FORBIDDEN_ACTIVE) {
      assert(
        !src.includes(needle),
        `${label} still contains forbidden active-runtime reference: ${needle}`,
      );
    }
  });
}

Deno.test("4D.14A.7F: legacy lessons-learned-graph.ts helper has been removed", async () => {
  const legacyUrl = new URL("./lessons-learned-graph.ts", __BTPM_SRC_BASE__);
  let exists = true;
  try {
    await Deno.stat(legacyUrl);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) exists = false;
    else throw e;
  }
  assert(!exists, "legacy lessons-learned-graph.ts must no longer exist");
});

Deno.test("4D.14A.7F: no active imports reference the legacy helper", async () => {
  const roots = [
    new URL("../", __BTPM_SRC_BASE__),
  ];
  for (const root of roots) {
    for await (const entry of Deno.readDir(root)) {
      if (!entry.isDirectory) continue;
      for await (const f of Deno.readDir(new URL(`${entry.name}/`, root))) {
        if (!f.isFile) continue;
        if (!f.name.endsWith(".ts")) continue;
        const url = new URL(`${entry.name}/${f.name}`, root);
        const src = await Deno.readTextFile(url);
        assert(
          !/import[^;]*lessons-learned-graph/.test(src),
          `${entry.name}/${f.name} still imports legacy helper`,
        );
      }
    }
  }
});

Deno.test("4D.14A.7F: create function wires Tenant runtime + PM authority BEFORE session", async () => {
  const src = await Deno.readTextFile(
    new URL("../create-project-lessons-learned-document/index.ts", __BTPM_SRC_BASE__),
  );
  assert(src.includes("createTenantSharePointPublishSession"));
  assert(src.includes("resolveProjectDocumentPublishTarget"));
  assert(src.includes("publishGeneratedDocumentBytes"));
  assert(src.includes('conflictBehavior: "fail"'));
  assert(src.includes("has_project_pm_authority"));
  assert(src.includes("buildLessonsLearnedFileName"));
  assert(src.includes("upsert_project_lessons_learned_document_metadata"));
  const authIdx = src.lastIndexOf("has_project_pm_authority");
  const sessionIdx = src.lastIndexOf("createTenantSharePointPublishSession");
  assert(authIdx > 0 && sessionIdx > authIdx, "authority must precede session");
});

Deno.test("4D.14A.7F: refresh function preserves link_broken classification rules", async () => {
  const src = await Deno.readTextFile(
    new URL("../refresh-project-lessons-learned-document-metadata/index.ts", __BTPM_SRC_BASE__),
  );
  assert(src.includes("createTenantSharePointPublishSession"));
  assert(src.includes("resolveProjectDocumentPublishTarget"));
  assert(src.includes("getSharePointDriveItemMetadata"));
  assert(src.includes("isSharePointItemUnderProjectRoot"));
  assert(src.includes('status: "link_broken"'));
  assert(src.includes('"project_lessons_learned_document_metadata_refreshed"'));
  assert(src.includes("has_project_pm_authority"));
  const authIdx = src.lastIndexOf("has_project_pm_authority");
  const sessionIdx = src.lastIndexOf("createTenantSharePointPublishSession");
  assert(authIdx > 0 && sessionIdx > authIdx, "authority must precede session");
});

Deno.test("4D.14A.7F: sharePointClient exposes publish_lessons_learned_document + conflictBehavior=fail", async () => {
  const src = await Deno.readTextFile(new URL("./sharePointClient.ts", __BTPM_SRC_BASE__));
  assert(src.includes('"publish_lessons_learned_document"'));
  assert(src.includes(`"replace" | "fail"`));
});
