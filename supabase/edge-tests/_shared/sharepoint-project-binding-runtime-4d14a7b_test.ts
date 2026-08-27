// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/sharepoint-project-binding-runtime-4d14a7b_test.ts', import.meta.url).href;
// Phase 4D.14A.7B — Unit tests for the shared SharePoint project-binding
// runtime, transport additions, and browse/select static contracts.
// No live Microsoft, Supabase, or Vault calls.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeFolderRelativePathWithinDrive,
  isSharePointItemUnderProjectRoot,
  matchProjectBindingLibrary,
  normalizeSharePointUrlForComparison,
  resolveSharePointProjectRoot,
  buildSharePointProjectBreadcrumbs,
  SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES,
} from "../../functions/_shared/sharePointProjectBindingRuntime.ts";
import {
  classifyDriveItemHttpStatus,
  getSharePointDriveItemByPath,
  getSharePointDriveItemMetadata,
  getSharePointDriveRoot,
  listSharePointDriveItemChildren,
  listSharePointSiteDrivesDetailed,
  type SharePointDriveItem,
} from "../../functions/_shared/sharePointClient.ts";
import type { SharePointRuntimeConfig } from "../../functions/_shared/tenantSharePoint.ts";

// ---------- Fixtures ----------

const RUNTIME: SharePointRuntimeConfig = {
  tenantId: "tenant",
  organizationId: "org",
  integrationId: "int",
  integrationName: "default",
  siteUrl: {
    href: "https://contoso.sharepoint.com/sites/btpm",
    hostname: "contoso.sharepoint.com",
    path: "/sites/btpm",
    isRootSite: false,
  },
  siteId: null,
};

function rootItem(): SharePointDriveItem {
  return {
    id: "root-id",
    name: "Project X",
    webUrl: "https://contoso.sharepoint.com/sites/btpm/Shared%20Documents/Project%20X",
    size: null,
    eTag: null,
    cTag: null,
    createdDateTime: null,
    lastModifiedDateTime: null,
    parentReference: { driveId: "drive-1", id: "parent-of-root", path: "/drive/root:" },
    folder: { childCount: 3 },
    file: null,
  };
}

function child(id: string, name: string, opts: Partial<SharePointDriveItem> = {}): SharePointDriveItem {
  return {
    id,
    name,
    webUrl: null,
    size: null,
    eTag: null,
    cTag: null,
    createdDateTime: null,
    lastModifiedDateTime: null,
    parentReference: {
      driveId: "drive-1",
      id: "root-id",
      path: "/drive/root:/Project X",
    },
    folder: null,
    file: null,
    ...opts,
  };
}

// ---------- normalize + match ----------

Deno.test("normalize strips query/fragment/forms/trailing slash", () => {
  assertEquals(
    normalizeSharePointUrlForComparison(
      "https://c.sharepoint.com/sites/x/Docs/Forms/AllItems.aspx?q=1",
    ),
    "https://c.sharepoint.com/sites/x/docs",
  );
});

Deno.test("library matcher: exact match wins", () => {
  const drives = [
    { id: "d1", webUrl: "https://contoso.sharepoint.com/sites/btpm/Docs" },
    { id: "d2", webUrl: "https://contoso.sharepoint.com/sites/btpm/Other" },
  ];
  const m = matchProjectBindingLibrary(
    drives,
    "https://contoso.sharepoint.com/sites/btpm/Docs",
  );
  assertEquals(m?.id, "d1");
});

Deno.test("library matcher: fallback to container drive", () => {
  const drives = [
    { id: "d1", webUrl: "https://contoso.sharepoint.com/sites/btpm/Docs" },
  ];
  const m = matchProjectBindingLibrary(
    drives,
    "https://contoso.sharepoint.com/sites/btpm/Docs/Sub/Folder",
  );
  assertEquals(m?.id, "d1");
});

Deno.test("library matcher: no match returns null", () => {
  const drives = [
    { id: "d1", webUrl: "https://contoso.sharepoint.com/sites/other/Docs" },
  ];
  const m = matchProjectBindingLibrary(
    drives,
    "https://contoso.sharepoint.com/sites/btpm/Docs",
  );
  assertEquals(m, null);
});

Deno.test("library matcher: missing url returns null", () => {
  assertEquals(matchProjectBindingLibrary([{ id: "d", webUrl: "x" }], null), null);
});

// ---------- folder relative path ----------

Deno.test("computeFolderRelativePathWithinDrive: exact drive => empty", () => {
  const r = computeFolderRelativePathWithinDrive(
    "https://c.sharepoint.com/sites/x/Docs",
    "https://c.sharepoint.com/sites/x/Docs",
  );
  assertEquals(r, "");
});

Deno.test("computeFolderRelativePathWithinDrive: nested folder", () => {
  const r = computeFolderRelativePathWithinDrive(
    "https://c.sharepoint.com/sites/x/Docs",
    "https://c.sharepoint.com/sites/x/Docs/Project%20X/Sub",
  );
  assertEquals(r, "/Project X/Sub");
});

Deno.test("computeFolderRelativePathWithinDrive: outside drive => null", () => {
  const r = computeFolderRelativePathWithinDrive(
    "https://c.sharepoint.com/sites/x/Docs",
    "https://c.sharepoint.com/sites/other/Docs/Y",
  );
  assertEquals(r, null);
});

// ---------- containment (pure) ----------

Deno.test("root item is under itself", () => {
  const r = rootItem();
  assert(isSharePointItemUnderProjectRoot(r, r));
});

Deno.test("direct child under root", () => {
  const r = rootItem();
  const c = child("c1", "a.pdf");
  assert(isSharePointItemUnderProjectRoot(c, r));
});

Deno.test("nested descendant under root", () => {
  const r = rootItem();
  const c = child("c2", "b.pdf", {
    parentReference: { driveId: "drive-1", id: "sub", path: "/drive/root:/Project X/Sub" },
  });
  assert(isSharePointItemUnderProjectRoot(c, r));
});

Deno.test("sibling outside root rejected", () => {
  const r = rootItem();
  const c = child("c3", "x.pdf", {
    parentReference: { driveId: "drive-1", id: "sib", path: "/drive/root:/Other" },
  });
  assert(!isSharePointItemUnderProjectRoot(c, r));
});

Deno.test("cross-drive escape rejected", () => {
  const r = rootItem();
  const c = child("c4", "x.pdf", {
    parentReference: { driveId: "drive-OTHER", id: "root-id", path: "/drive/root:/Project X" },
  });
  assert(!isSharePointItemUnderProjectRoot(c, r));
});

// ---------- transport HTTP classifier ----------

Deno.test("classifyDriveItemHttpStatus covers all buckets", () => {
  assertEquals(classifyDriveItemHttpStatus(200), "success");
  assertEquals(classifyDriveItemHttpStatus(401), "token_rejected");
  assertEquals(classifyDriveItemHttpStatus(403), "permission_denied");
  assertEquals(classifyDriveItemHttpStatus(404), "item_not_found");
  assertEquals(classifyDriveItemHttpStatus(429), "rate_limited");
  assertEquals(classifyDriveItemHttpStatus(503), "graph_unavailable");
  assertEquals(classifyDriveItemHttpStatus(418), "graph_unavailable");
});

// ---------- transport helpers (mock fetch) ----------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("listSharePointSiteDrivesDetailed returns id+webUrl", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      value: [
        { id: "d1", webUrl: "https://c.sharepoint.com/sites/x/D1" },
        { id: "d2", webUrl: "https://c.sharepoint.com/sites/x/D2" },
        { id: "", webUrl: "skip" },
      ],
    });
  const r = await listSharePointSiteDrivesDetailed({
    accessToken: "t",
    requestId: "rid",
    siteId: "s",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "success");
  assertEquals(r.drives.length, 2);
});

Deno.test("getSharePointDriveRoot success", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      id: "root-id",
      name: "R",
      parentReference: { driveId: "d" },
    });
  const r = await getSharePointDriveRoot({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "success");
  assertEquals(r.item?.id, "root-id");
});

Deno.test("getSharePointDriveItemByPath encodes segments", async () => {
  let seenUrl = "";
  const fetchImpl = async (input: RequestInfo | URL) => {
    seenUrl = String(input);
    return jsonResponse({ id: "x", name: "n" });
  };
  const r = await getSharePointDriveItemByPath({
    accessToken: "t",
    requestId: "rid",
    driveId: "drv id",
    relativePath: "/A B/C&D",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "success");
  assert(seenUrl.includes("/drives/drv%20id/root:/A%20B/C%26D"));
});

Deno.test("getSharePointDriveItemMetadata 404 -> item_not_found", async () => {
  const fetchImpl = async () => new Response("nope", { status: 404 });
  const r = await getSharePointDriveItemMetadata({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    itemId: "i",
    operation: "read_selected_evidence_item",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "item_not_found");
});

Deno.test("getSharePointDriveItemMetadata 403 -> permission_denied", async () => {
  const fetchImpl = async () => new Response("no", { status: 403 });
  const r = await getSharePointDriveItemMetadata({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    itemId: "i",
    operation: "read_selected_evidence_item",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "permission_denied");
});

Deno.test("listSharePointDriveItemChildren rate-limited", async () => {
  const fetchImpl = async () => new Response("", { status: 429 });
  const r = await listSharePointDriveItemChildren({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    itemId: "i",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "rate_limited");
});

Deno.test("listSharePointDriveItemChildren 500 -> graph_unavailable", async () => {
  const fetchImpl = async () => new Response("", { status: 500 });
  const r = await listSharePointDriveItemChildren({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    itemId: "i",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "graph_unavailable");
});

Deno.test("transport timeout classified", async () => {
  const fetchImpl = async () => { throw new DOMException("aborted", "AbortError"); };
  const r = await getSharePointDriveRoot({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs: 5,
  });
  assertEquals(r.category, "timeout");
});

Deno.test("transport network error classified", async () => {
  const fetchImpl = async () => { throw new Error("boom"); };
  const r = await getSharePointDriveRoot({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "network_error");
});

// ---------- log leakage guard ----------

Deno.test("transport does not log raw drive/item ids in output", async () => {
  const captured: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => { captured.push(a.join(" ")); };
  try {
    const fetchImpl = async () => jsonResponse({ id: "x", name: "n" });
    await getSharePointDriveItemMetadata({
      accessToken: "SECRET_TOKEN",
      requestId: "rid",
      driveId: "DRIVE_LEAK",
      itemId: "ITEM_LEAK",
      operation: "read_selected_evidence_item",
      fetchImpl: fetchImpl as typeof fetch,
    });
  } finally { console.log = origLog; }
  const joined = captured.join("\n");
  assert(!joined.includes("SECRET_TOKEN"));
  assert(!joined.includes("DRIVE_LEAK"));
  assert(!joined.includes("ITEM_LEAK"));
});

// ---------- end-to-end project-root resolution ----------

Deno.test("resolveSharePointProjectRoot happy path", async () => {
  const siteId = "contoso.sharepoint.com,sc-1,site-1";
  const driveWebUrl = "https://contoso.sharepoint.com/sites/btpm/Docs";
  const folderWebUrl = `${driveWebUrl}/Project%20X`;
  const seq: Array<(url: string) => Response> = [
    // site-by-path
    (_u) => jsonResponse({ id: siteId, webUrl: RUNTIME.siteUrl.href }),
    // drives
    (_u) => jsonResponse({
      value: [{ id: "drive-1", webUrl: driveWebUrl }],
    }),
    // item-by-path
    (_u) => jsonResponse({
      id: "root-id",
      name: "Project X",
      webUrl: folderWebUrl,
      parentReference: { driveId: "drive-1", path: "/drive/root:" },
      folder: { childCount: 0 },
    }),
  ];
  let call = 0;
  const fetchImpl = async (input: RequestInfo | URL) => seq[call++](String(input));
  const r = await resolveSharePointProjectRoot({
    accessToken: "t",
    runtime: RUNTIME,
    binding: {
      binding_status: "validated",
      folder_web_url: folderWebUrl,
      resolved_library_web_url: driveWebUrl,
    },
    requestId: "rid",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(r.ok, JSON.stringify(r));
  assertEquals(r.root.driveId, "drive-1");
  assertEquals(r.root.siteId, siteId);
});

Deno.test("resolveSharePointProjectRoot: binding not validated", async () => {
  const r = await resolveSharePointProjectRoot({
    accessToken: "t",
    runtime: RUNTIME,
    binding: { binding_status: "pending", folder_web_url: "x", resolved_library_web_url: "y" },
    requestId: "rid",
    fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch,
  });
  assert(!r.ok);
  assertEquals(r.publicError.body.error, "project_sharepoint_folder_not_configured");
});

Deno.test("resolveSharePointProjectRoot: bound library not found", async () => {
  const seq = [
    () => jsonResponse({ id: "s", webUrl: RUNTIME.siteUrl.href }),
    () => jsonResponse({
      value: [{ id: "d", webUrl: "https://contoso.sharepoint.com/sites/btpm/Other" }],
    }),
  ];
  let call = 0;
  const fetchImpl = async () => seq[call++]();
  const r = await resolveSharePointProjectRoot({
    accessToken: "t",
    runtime: RUNTIME,
    binding: {
      binding_status: "validated",
      folder_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs/P",
      resolved_library_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs",
    },
    requestId: "rid",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
  assertEquals(r.publicError.body.error, "bound_library_not_found");
});

Deno.test("resolveSharePointProjectRoot: folder outside library", async () => {
  const seq = [
    () => jsonResponse({ id: "s", webUrl: RUNTIME.siteUrl.href }),
    () => jsonResponse({
      value: [{ id: "d", webUrl: "https://contoso.sharepoint.com/sites/btpm/Docs" }],
    }),
  ];
  let call = 0;
  const fetchImpl = async () => seq[call++]();
  const r = await resolveSharePointProjectRoot({
    accessToken: "t",
    runtime: RUNTIME,
    binding: {
      binding_status: "validated",
      folder_web_url: "https://contoso.sharepoint.com/sites/other/Docs/P",
      resolved_library_web_url: "https://contoso.sharepoint.com/sites/other/Docs",
    },
    requestId: "rid",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
  assertEquals(r.publicError.body.error, "bound_library_not_found");
});

Deno.test("resolveSharePointProjectRoot: project folder 404", async () => {
  const driveWebUrl = "https://contoso.sharepoint.com/sites/btpm/Docs";
  const seq = [
    () => jsonResponse({ id: "s", webUrl: RUNTIME.siteUrl.href }),
    () => jsonResponse({ value: [{ id: "drv", webUrl: driveWebUrl }] }),
    () => new Response("", { status: 404 }),
  ];
  let call = 0;
  const fetchImpl = async () => seq[call++]();
  const r = await resolveSharePointProjectRoot({
    accessToken: "t",
    runtime: RUNTIME,
    binding: {
      binding_status: "validated",
      folder_web_url: `${driveWebUrl}/Missing`,
      resolved_library_web_url: driveWebUrl,
    },
    requestId: "rid",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
  assertEquals(r.publicError.body.error, "project_folder_not_found");
});

Deno.test("resolveSharePointProjectRoot: site permission denied", async () => {
  const fetchImpl = async () => new Response("", { status: 403 });
  const r = await resolveSharePointProjectRoot({
    accessToken: "t",
    runtime: RUNTIME,
    binding: {
      binding_status: "validated",
      folder_web_url: "https://x/y",
      resolved_library_web_url: "https://x/y",
    },
    requestId: "rid",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
  assertEquals(r.publicError.body.error, "sharepoint_permission_denied");
});

// ---------- breadcrumbs ----------

Deno.test("breadcrumbs stop at project root when direct child", async () => {
  const root = { siteId: "s", driveId: "drive-1", rootItem: rootItem() };
  const current = child("c", "a.pdf");
  const crumbs = await buildSharePointProjectBreadcrumbs({
    accessToken: "t",
    requestId: "rid",
    root,
    currentItem: current,
    fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch,
  });
  assertEquals(crumbs.map((c) => c.id), ["root-id", "c"]);
});

Deno.test("breadcrumbs cannot escape root even if parent lookup succeeds outside", async () => {
  const root = { siteId: "s", driveId: "drive-1", rootItem: rootItem() };
  const current = child("c", "a.pdf", {
    parentReference: { driveId: "drive-1", id: "escaped-parent", path: "/drive/root:/Project X/Sub" },
  });
  // Parent lookup returns an item OUTSIDE the project root.
  const fetchImpl = async () =>
    jsonResponse({
      id: "escaped-parent",
      name: "outside",
      parentReference: { driveId: "drive-1", id: "x", path: "/drive/root:/Other" },
    });
  const crumbs = await buildSharePointProjectBreadcrumbs({
    accessToken: "t",
    requestId: "rid",
    root,
    currentItem: current,
    fetchImpl: fetchImpl as typeof fetch,
  });
  // Must include root and current, never the escaped item.
  assert(crumbs.some((c) => c.id === "root-id"));
  assert(crumbs.some((c) => c.id === "c"));
  assert(!crumbs.some((c) => c.id === "escaped-parent"));
});

// ---------- public error catalog ----------

Deno.test("public note catalog covers all codes", () => {
  const required = [
    "project_sharepoint_folder_not_configured",
    "project_sharepoint_binding_invalid",
    "bound_library_not_found",
    "project_folder_not_found",
    "item_not_found",
    "outside_project_scope",
    "sharepoint_permission_denied",
    "sharepoint_site_unavailable",
    "sharepoint_temporarily_unavailable",
    "sharepoint_not_configured",
    "sharepoint_access_blocked",
    "sharepoint_configuration_invalid",
    "sharepoint_configuration_unavailable",
    "microsoft_graph_not_configured",
    "microsoft_graph_access_blocked",
    "microsoft_graph_configuration_invalid",
    "microsoft_graph_configuration_unavailable",
  ] as const;
  for (const k of required) {
    assert(typeof SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES[k] === "string");
    assert(SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES[k].length > 0);
  }
});

// ---------- static contract: no Global secret / duplicated helper reads ----------

async function readFile(rel: string): Promise<string> {
  const url = new URL(rel, __BTPM_SRC_BASE__);
  return await Deno.readTextFile(url);
}

Deno.test("browse function: no M365_ / BTPM_SP_ / local Graph helper", async () => {
  const src = await readFile("../browse-governance-decision-sharepoint-files/index.ts");
  assert(!src.includes("M365_TENANT_ID"));
  assert(!src.includes("M365_CLIENT_ID"));
  assert(!src.includes("M365_CLIENT_SECRET"));
  assert(!src.includes("BTPM_SP_SITE_URL"));
  assert(!src.includes("BTPM_SP_SITE_ID"));
  assert(!src.includes("login.microsoftonline.com"));
  assert(!src.includes("graph.microsoft.com/v1.0"));
  // Uses canonical resolvers.
  assert(src.includes("resolveTenantSharePointRuntimeConfig"));
  assert(src.includes("resolveAndAcquireTenantMicrosoftGraph"));
  assert(src.includes("resolveSharePointProjectRoot"));
});

Deno.test("select function: no M365_ / BTPM_SP_ / local Graph helper", async () => {
  const src = await readFile("../select-governance-decision-sharepoint-evidence-files/index.ts");
  assert(!src.includes("M365_TENANT_ID"));
  assert(!src.includes("M365_CLIENT_ID"));
  assert(!src.includes("M365_CLIENT_SECRET"));
  assert(!src.includes("BTPM_SP_SITE_URL"));
  assert(!src.includes("BTPM_SP_SITE_ID"));
  assert(!src.includes("login.microsoftonline.com"));
  assert(!src.includes("graph.microsoft.com/v1.0"));
  assert(src.includes("resolveTenantSharePointRuntimeConfig"));
  assert(src.includes("resolveAndAcquireTenantMicrosoftGraph"));
  assert(src.includes("resolveSharePointProjectRoot"));
  // Server-authoritative hash uses root site/drive.
  assert(src.includes("`${siteId}|${driveId}|${itemId}`"));
  // Runtime failure fails-closed BEFORE per-item metadata loop.
  const rootFailIdx = src.indexOf("project_root_failed");
  const loopIdx = src.indexOf("for (const raw of items)");
  assert(rootFailIdx > 0 && loopIdx > 0 && rootFailIdx < loopIdx);
});

Deno.test("select function: authority precedes runtime resolution", async () => {
  const src = await readFile("../select-governance-decision-sharepoint-evidence-files/index.ts");
  const authIdx = src.indexOf("_gov_assert_project_write");
  const runtimeIdx = src.indexOf("resolveTenantSharePointRuntimeConfig({");
  assert(authIdx > 0 && runtimeIdx > 0 && authIdx < runtimeIdx);
});

Deno.test("browse function: authority precedes runtime resolution", async () => {
  const src = await readFile("../browse-governance-decision-sharepoint-files/index.ts");
  const authIdx = src.indexOf("_gov_assert_project_read");
  const runtimeIdx = src.indexOf("resolveTenantSharePointRuntimeConfig({");
  assert(authIdx > 0 && runtimeIdx > 0 && authIdx < runtimeIdx);
});
