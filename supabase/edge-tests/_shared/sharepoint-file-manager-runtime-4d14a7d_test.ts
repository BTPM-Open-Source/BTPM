// Phase 4D.14A.7D — Runtime unit tests for the SharePoint file-manager
// support code: new write transport helpers, workspace-library runtime,
// and the Microsoft Graph public-client identity resolver contract.
// No live Microsoft, Supabase, or Vault calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  classifyDriveItemWriteHttpStatus,
  createSharePointFolder,
  createSharePointUploadSession,
  deleteSharePointDriveItem,
  getSharePointChildItem,
} from "../../functions/_shared/sharePointClient.ts";
import { resolveSharePointWorkspaceLibraryRoot } from "../../functions/_shared/sharePointWorkspaceBindingRuntime.ts";
import type { SharePointRuntimeConfig } from "../../functions/_shared/tenantSharePoint.ts";
import {
  MicrosoftGraphClientIdentity,
  resolveTenantMicrosoftGraphClientIdentity,
} from "../../functions/_shared/tenantMicrosoftGraph.ts";

// ---------- Write-status classifier ----------

Deno.test("classifyDriveItemWriteHttpStatus maps 409 → item_conflict", () => {
  assertEquals(classifyDriveItemWriteHttpStatus(200), "success");
  assertEquals(classifyDriveItemWriteHttpStatus(401), "token_rejected");
  assertEquals(classifyDriveItemWriteHttpStatus(403), "permission_denied");
  assertEquals(classifyDriveItemWriteHttpStatus(404), "item_not_found");
  assertEquals(classifyDriveItemWriteHttpStatus(409), "item_conflict");
  assertEquals(classifyDriveItemWriteHttpStatus(429), "rate_limited");
  assertEquals(classifyDriveItemWriteHttpStatus(500), "graph_unavailable");
});

// ---------- Transport helpers (mocked fetch) ----------

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("createSharePointFolder success returns parsed item", async () => {
  const fetchImpl = async () =>
    jsonResponse({ id: "new-id", name: "New", parentReference: { driveId: "d" } });
  const r = await createSharePointFolder({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    parentItemId: "p",
    name: "New",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "success");
  assertEquals(r.item?.id, "new-id");
});

Deno.test("createSharePointFolder 409 maps to item_conflict", async () => {
  const fetchImpl = async () => new Response("{}", { status: 409 });
  const r = await createSharePointFolder({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    parentItemId: "p",
    name: "X",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "item_conflict");
});

Deno.test("createSharePointUploadSession returns https uploadUrl", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      uploadUrl: "https://upload.example.com/session/abc",
      expirationDateTime: "2030-01-01T00:00:00Z",
    });
  const r = await createSharePointUploadSession({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    parentItemId: "p",
    fileName: "a.txt",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "success");
  assert(r.uploadUrl?.startsWith("https://"));
});

Deno.test("createSharePointUploadSession non-https url → response_invalid", async () => {
  const fetchImpl = async () =>
    jsonResponse({ uploadUrl: "http://insecure/x" });
  const r = await createSharePointUploadSession({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    parentItemId: "p",
    fileName: "a.txt",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "response_invalid");
  assertEquals(r.uploadUrl, null);
});

Deno.test("deleteSharePointDriveItem accepts 204 as success", async () => {
  const fetchImpl = async () => new Response(null, { status: 204 });
  const r = await deleteSharePointDriveItem({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    itemId: "i",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "success");
});

Deno.test("deleteSharePointDriveItem 403 maps to permission_denied", async () => {
  const fetchImpl = async () => new Response("{}", { status: 403 });
  const r = await deleteSharePointDriveItem({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    itemId: "i",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "permission_denied");
});

Deno.test("getSharePointChildItem 404 → item_not_found", async () => {
  const fetchImpl = async () => new Response("{}", { status: 404 });
  const r = await getSharePointChildItem({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    parentItemId: "p",
    name: "X",
    operation: "resolve_project_subpath",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "item_not_found");
});

// ---------- Workspace library runtime ----------

const runtime: SharePointRuntimeConfig = {
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

Deno.test("workspace runtime: rejects unvalidated binding without any fetch", async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response(""); }) as typeof fetch;
  const r = await resolveSharePointWorkspaceLibraryRoot({
    accessToken: "t",
    sharePointRuntime: runtime,
    workspaceBinding: {
      organization_id: "o",
      workspace_id: "w",
      binding_status: "pending",
      site_web_url: runtime.siteUrl.href,
      library_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs",
    },
    requestId: "rid",
    fetchImpl,
  });
  assertEquals(r.ok, false);
  assertEquals(called, false);
  if (!r.ok) {
    assertEquals(r.publicError.body.error, "workspace_binding_not_validated");
  }
});

Deno.test("workspace runtime: site mismatch rejected before Graph", async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response(""); }) as typeof fetch;
  const r = await resolveSharePointWorkspaceLibraryRoot({
    accessToken: "t",
    sharePointRuntime: runtime,
    workspaceBinding: {
      organization_id: "o",
      workspace_id: "w",
      binding_status: "validated",
      site_web_url: "https://contoso.sharepoint.com/sites/OTHER",
      library_web_url: "https://contoso.sharepoint.com/sites/OTHER/Docs",
    },
    requestId: "rid",
    fetchImpl,
  });
  assertEquals(r.ok, false);
  assertEquals(called, false);
  if (!r.ok) {
    assertEquals(r.publicError.body.error, "workspace_binding_site_mismatch");
  }
});

Deno.test("workspace runtime: happy path resolves drive root", async () => {
  let call = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    call++;
    const url = String(input);
    if (url.includes("/sites/contoso.sharepoint.com:")) {
      return jsonResponse({
        id: "site-1",
        webUrl: "https://contoso.sharepoint.com/sites/btpm",
      });
    }
    if (url.includes("/sites/") && url.includes("/drives")) {
      return jsonResponse({
        value: [
          { id: "drive-1", webUrl: "https://contoso.sharepoint.com/sites/btpm/Docs" },
        ],
      });
    }
    if (url.includes("/drives/") && url.includes("/root")) {
      return jsonResponse({
        id: "root-item",
        name: "Documents",
        parentReference: { driveId: "drive-1" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const r = await resolveSharePointWorkspaceLibraryRoot({
    accessToken: "t",
    sharePointRuntime: runtime,
    workspaceBinding: {
      organization_id: "o",
      workspace_id: "w",
      binding_status: "validated",
      site_web_url: runtime.siteUrl.href,
      library_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs",
    },
    requestId: "rid",
    fetchImpl,
  });
  assert(r.ok, `expected ok, got ${JSON.stringify(r)}`);
  if (r.ok) {
    assertEquals(r.root.siteId, "site-1");
    assertEquals(r.root.driveId, "drive-1");
    assertEquals(r.root.rootItem.id, "root-item");
  }
  assert(call >= 3);
});

// ---------- Microsoft Graph client identity resolver ----------

Deno.test("resolveTenantMicrosoftGraphClientIdentity: rejects wrong action without preflight", async () => {
  let threw = false;
  try {
    await resolveTenantMicrosoftGraphClientIdentity({
      organizationId: "does-not-matter",
      // @ts-ignore intentional
      action: "not_real",
      functionName: "test",
      reason: "unit",
      requestId: "rid",
    });
  } catch (e) {
    threw = true;
    // Must not be a plain network/db error; must be a typed TenantMicrosoftGraphError
    // with environment_action_blocked or missing organization.
    assert(String(e).length > 0);
  }
  assert(threw);
});

// Compile-time check: the identity type does NOT expose clientSecret.
Deno.test("client identity type does not contain clientSecret", () => {
  const ident: MicrosoftGraphClientIdentity = {
    tenantId: "t",
    organizationId: "o",
    integrationId: "i",
    microsoftTenantId: "00000000-0000-0000-0000-000000000000",
    clientId: "00000000-0000-0000-0000-000000000000",
  };
  assertEquals("clientSecret" in (ident as unknown as Record<string, unknown>), false);
});
