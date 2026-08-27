// Phase 4D.14A.7E — Unit tests for the shared generated-document
// SharePoint publisher transport and normalization. No live
// Microsoft, Supabase, or Vault calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  getSharePointSiteDefaultDrive,
  uploadSharePointFileBytes,
} from "../../functions/_shared/sharePointClient.ts";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ---------- getSharePointSiteDefaultDrive ----------

Deno.test("getSharePointSiteDefaultDrive success returns id + webUrl", async () => {
  const fetchImpl = async (input: string | URL) => {
    assert(String(input).endsWith("/drive?$select=id,webUrl"));
    return jsonResponse({ id: "drive-1", webUrl: "https://x.sharepoint.com/sites/a/Shared%20Documents" });
  };
  const r = await getSharePointSiteDefaultDrive({
    accessToken: "t", requestId: "rid", siteId: "site-1",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "success");
  assertEquals(r.drive?.id, "drive-1");
});

Deno.test("getSharePointSiteDefaultDrive 403 → permission_denied", async () => {
  const fetchImpl = async () => new Response("nope", { status: 403 });
  const r = await getSharePointSiteDefaultDrive({
    accessToken: "t", requestId: "rid", siteId: "site-1",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "permission_denied");
});

Deno.test("getSharePointSiteDefaultDrive missing fields → response_invalid", async () => {
  const fetchImpl = async () => jsonResponse({ id: "" });
  const r = await getSharePointSiteDefaultDrive({
    accessToken: "t", requestId: "rid", siteId: "site-1",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assertEquals(r.category, "response_invalid");
});

// ---------- uploadSharePointFileBytes ----------

Deno.test("uploadSharePointFileBytes success returns itemId + webUrl", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedContentType = "";
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedMethod = String(init?.method ?? "");
    capturedContentType = String((init?.headers as any)?.["Content-Type"] ?? "");
    return jsonResponse({ id: "item-1", webUrl: "https://x.sharepoint.com/x.docx" });
  };
  const r = await uploadSharePointFileBytes({
    accessToken: "t",
    requestId: "rid",
    driveId: "d",
    parentItemId: "p",
    fileName: "Report.docx",
    bytes: new Uint8Array([1, 2, 3]),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_project_charter",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.itemId, "item-1");
    assertEquals(r.webUrl, "https://x.sharepoint.com/x.docx");
  }
  // PUT + replace
  assertEquals(capturedMethod, "PUT");
  assert(capturedUrl.includes("conflictBehavior=replace"));
  assert(capturedUrl.includes("/content"));
  assertEquals(
    capturedContentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
});

Deno.test("uploadSharePointFileBytes strips path characters in filename", async () => {
  let capturedUrl = "";
  const fetchImpl = async (input: string | URL) => {
    capturedUrl = String(input);
    return jsonResponse({ id: "item-1", webUrl: "https://x/" });
  };
  const r = await uploadSharePointFileBytes({
    accessToken: "t", requestId: "rid", driveId: "d", parentItemId: "p",
    fileName: "Bad/Name*Rep?ort.pptx",
    bytes: new Uint8Array(),
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    operation: "publish_project_status_deck",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(r.ok);
  // Sanitizer strips path-unsafe characters.
  assert(!capturedUrl.includes("*"), "asterisk leaked");
  assert(!capturedUrl.includes("%2A"), "asterisk encoded leaked");
  assert(!capturedUrl.includes("%3F"), "question-mark encoded leaked");
  // Sanitized filename appears verbatim in the URL.
  assert(capturedUrl.includes("BadNameReport.pptx"));
});

Deno.test("uploadSharePointFileBytes 423 relays body and status", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: { code: "resourceLocked" } }), { status: 423 });
  const r = await uploadSharePointFileBytes({
    accessToken: "t", requestId: "rid", driveId: "d", parentItemId: "p",
    fileName: "x.docx",
    bytes: new Uint8Array(),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_project_charter",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
  if (!r.ok) {
    assertEquals(r.httpStatus, 423);
    assert(r.body.includes("resourceLocked"));
  }
});

Deno.test("uploadSharePointFileBytes 429 exposes Retry-After", async () => {
  const fetchImpl = async () =>
    new Response("{}", { status: 429, headers: { "Retry-After": "12" } });
  const r = await uploadSharePointFileBytes({
    accessToken: "t", requestId: "rid", driveId: "d", parentItemId: "p",
    fileName: "x.docx",
    bytes: new Uint8Array(),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_project_charter",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
  if (!r.ok) {
    assertEquals(r.httpStatus, 429);
    assertEquals(r.retryAfter, "12");
  }
});

Deno.test("uploadSharePointFileBytes network failure → transport error", async () => {
  const fetchImpl = async () => { throw new Error("boom"); };
  const r = await uploadSharePointFileBytes({
    accessToken: "t", requestId: "rid", driveId: "d", parentItemId: "p",
    fileName: "x.docx",
    bytes: new Uint8Array(),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_project_charter",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
  if (!r.ok) {
    assertEquals(r.httpStatus, null);
    assertEquals(r.transport, "network_error");
  }
});

Deno.test("uploadSharePointFileBytes empty filename → response_invalid", async () => {
  const fetchImpl = async () => jsonResponse({ id: "x", webUrl: "https://x/" });
  const r = await uploadSharePointFileBytes({
    accessToken: "t", requestId: "rid", driveId: "d", parentItemId: "p",
    fileName: "///",
    bytes: new Uint8Array(),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_project_charter",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
  if (!r.ok) {
    assertEquals(r.httpStatus, null);
    assertEquals(r.transport, null);
  }
});

Deno.test("uploadSharePointFileBytes malformed success body → response_invalid", async () => {
  const fetchImpl = async () => jsonResponse({ id: "" });
  const r = await uploadSharePointFileBytes({
    accessToken: "t", requestId: "rid", driveId: "d", parentItemId: "p",
    fileName: "x.docx",
    bytes: new Uint8Array(),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_project_charter",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert(!r.ok);
});
