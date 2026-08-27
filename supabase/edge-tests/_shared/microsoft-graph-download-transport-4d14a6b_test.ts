// Phase 4D.14A.6B — Transport-only tests for the runtime Graph
// download helper. No real Graph calls; a mocked fetch is injected.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  downloadMicrosoftGraphDriveItemBytes,
  toSafeGraphRuntimeFilePublicError,
  toSafeGraphTokenAcquisitionPublicError,
} from "../../functions/_shared/microsoftGraphClient.ts";

type MockCall = { url: string; init: RequestInit };

function makeMockFetch(responder: (call: MockCall) => Response | Promise<Response>) {
  const calls: MockCall[] = [];
  const impl: typeof fetch = (async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    const call = { url, init: init ?? {} };
    calls.push(call);
    return await responder(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

Deno.test("uses supplied token and correct /drives/{drive}/items/{item}/content path (GET only)", async () => {
  const { impl, calls } = makeMockFetch(() => new Response(new Uint8Array([1, 2, 3])));
  const r = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: "SUPPLIED_TOKEN",
    driveId: "b!driveXYZ",
    itemId: "01ABC",
    operation: "download_decision_case_evidence",
    requestId: "req-1",
    fetchImpl: impl,
  });
  assert(r.ok);
  assertEquals(r.category, "success");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].init.method, "GET");
  assertEquals(
    calls[0].url,
    "https://graph.microsoft.com/v1.0/drives/b!driveXYZ/items/01ABC/content",
  );
  const headers = new Headers((calls[0].init.headers ?? {}) as HeadersInit);
  assertEquals(headers.get("Authorization"), "Bearer SUPPLIED_TOKEN");
  // Redirect option should be follow
  assertEquals((calls[0].init as any).redirect, "follow");
});

Deno.test("403 -> access_forbidden", async () => {
  const { impl } = makeMockFetch(() => new Response("forbidden body", { status: 403 }));
  const r = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: "t", driveId: "d", itemId: "i",
    operation: "download_decision_case_evidence", requestId: "r", fetchImpl: impl,
  });
  assertFalse(r.ok);
  assertEquals(r.category, "access_forbidden");
});

Deno.test("404 -> item_not_found", async () => {
  const { impl } = makeMockFetch(() => new Response("", { status: 404 }));
  const r = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: "t", driveId: "d", itemId: "i",
    operation: "download_decision_case_bundle_file", requestId: "r", fetchImpl: impl,
  });
  assertEquals(r.category, "item_not_found");
});

Deno.test("429 -> rate_limited", async () => {
  const { impl } = makeMockFetch(() => new Response("", { status: 429 }));
  const r = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: "t", driveId: "d", itemId: "i",
    operation: "download_roadmap_story_source", requestId: "r", fetchImpl: impl,
  });
  assertEquals(r.category, "rate_limited");
});

Deno.test("500 -> graph_unavailable", async () => {
  const { impl } = makeMockFetch(() => new Response("", { status: 502 }));
  const r = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: "t", driveId: "d", itemId: "i",
    operation: "download_decision_case_evidence", requestId: "r", fetchImpl: impl,
  });
  assertEquals(r.category, "graph_unavailable");
});

Deno.test("network error -> network_error", async () => {
  const impl: typeof fetch = (async () => {
    throw new TypeError("connection refused");
  }) as unknown as typeof fetch;
  const r = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: "t", driveId: "d", itemId: "i",
    operation: "download_decision_case_evidence", requestId: "r", fetchImpl: impl,
  });
  assertEquals(r.category, "network_error");
});

Deno.test("abort/timeout -> timeout", async () => {
  const impl: typeof fetch = (async () => {
    const e = new Error("aborted");
    (e as any).name = "AbortError";
    throw e;
  }) as unknown as typeof fetch;
  const r = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: "t", driveId: "d", itemId: "i",
    operation: "download_decision_case_evidence", requestId: "r", fetchImpl: impl, timeoutMs: 5,
  });
  assertEquals(r.category, "timeout");
});

Deno.test("success returns bytes", async () => {
  const { impl } = makeMockFetch(() => new Response(new Uint8Array([9, 8, 7, 6])));
  const r = await downloadMicrosoftGraphDriveItemBytes({
    accessToken: "t", driveId: "d", itemId: "i",
    operation: "download_decision_case_evidence", requestId: "r", fetchImpl: impl,
  });
  assert(r.ok);
  assertEquals(r.bytes?.byteLength, 4);
});

Deno.test("safe public error mapper returns fixed vocabulary only", () => {
  const p = toSafeGraphRuntimeFilePublicError("access_forbidden");
  assertEquals(p.error, "microsoft_graph_file_unavailable");
  assert(!p.note.includes("{"));
});

Deno.test("token acquisition safe mapper vocabulary", () => {
  assertEquals(
    toSafeGraphTokenAcquisitionPublicError("credential_rejected").error,
    "microsoft_graph_not_configured",
  );
  assertEquals(
    toSafeGraphTokenAcquisitionPublicError("access_forbidden").error,
    "microsoft_graph_access_blocked",
  );
  assertEquals(
    toSafeGraphTokenAcquisitionPublicError("timeout").error,
    "microsoft_graph_configuration_unavailable",
  );
  assertEquals(
    toSafeGraphTokenAcquisitionPublicError("network_error").error,
    "microsoft_graph_configuration_unavailable",
  );
});

Deno.test("logs contain no drive/item identifier keys and no Authorization", async () => {
  // Capture console output
  const originalLog = console.log;
  const captured: string[] = [];
  console.log = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    const { impl } = makeMockFetch(() => new Response(new Uint8Array([1])));
    await downloadMicrosoftGraphDriveItemBytes({
      accessToken: "SECRET_TOKEN",
      driveId: "DRIVE_LEAK",
      itemId: "ITEM_LEAK",
      operation: "download_decision_case_evidence",
      requestId: "req-123",
      fetchImpl: impl,
    });
  } finally {
    console.log = originalLog;
  }
  const joined = captured.join("\n");
  assertFalse(joined.includes("SECRET_TOKEN"), "token leaked in log");
  assertFalse(joined.includes("DRIVE_LEAK"), "driveId leaked in log");
  assertFalse(joined.includes("ITEM_LEAK"), "itemId leaked in log");
  assertFalse(/authorization/i.test(joined), "Authorization key leaked in log");
});
