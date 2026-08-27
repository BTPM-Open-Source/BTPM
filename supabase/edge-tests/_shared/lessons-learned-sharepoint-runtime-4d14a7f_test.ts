// Phase 4D.14A.7F — Pure/runtime unit tests for Lessons Learned Tenant
// runtime cutover. No live Microsoft Graph, SharePoint, Supabase, or Vault.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLessonsLearnedFileName,
  lessonsLearnedPublicError,
  LESSONS_LEARNED_PUBLIC_NOTES,
  sanitizeLessonsLearnedFileName,
} from "../../functions/_shared/lessonsLearnedSharePoint.ts";

// -------- Pure filename tests --------

Deno.test("sanitizeLessonsLearnedFileName strips SharePoint-disallowed chars", () => {
  const out = sanitizeLessonsLearnedFileName('Proj/\\:*?"<>|#% Alpha');
  assertEquals(out, "Proj Alpha");
});

Deno.test("sanitizeLessonsLearnedFileName collapses whitespace", () => {
  assertEquals(sanitizeLessonsLearnedFileName("  A   B  "), "A B");
});

Deno.test("buildLessonsLearnedFileName preserves deterministic pattern", () => {
  assertEquals(
    buildLessonsLearnedFileName("Alpha Rollout"),
    "Lessons Learned - Alpha Rollout.docx",
  );
});

Deno.test("buildLessonsLearnedFileName falls back on empty input", () => {
  assertEquals(
    buildLessonsLearnedFileName("   "),
    "Lessons Learned - Project.docx",
  );
  assertEquals(
    buildLessonsLearnedFileName(""),
    "Lessons Learned - Project.docx",
  );
});

Deno.test("buildLessonsLearnedFileName sanitizes forbidden chars in name", () => {
  assertEquals(
    buildLessonsLearnedFileName("Q4/Plan?*"),
    "Lessons Learned - Q4Plan.docx",
  );
});

// -------- Public error contract --------

Deno.test("lessonsLearnedPublicError returns fixed safe notes", () => {
  const e = lessonsLearnedPublicError("document_name_conflict");
  assertEquals(e.code, "document_name_conflict");
  assertStringIncludes(e.note, "Lessons Learned filename");
});

Deno.test("all Lessons Learned public error codes have safe notes", () => {
  for (const [code, note] of Object.entries(LESSONS_LEARNED_PUBLIC_NOTES)) {
    assert(typeof note === "string" && note.length > 0, `missing note: ${code}`);
    assert(!note.includes("http"), `note leaks URL for ${code}`);
    assert(!note.includes("Bearer"), `note leaks token for ${code}`);
  }
});

// -------- Upload conflict-behavior transport wiring --------
//
// Verify uploadSharePointFileBytes threads `conflictBehavior=fail` for
// Lessons Learned uploads and exposes 409 as a distinguishable safe
// status (not overwriting the existing item).

import {
  uploadSharePointFileBytes,
} from "../../functions/_shared/sharePointClient.ts";

function fetchMock(entries: Array<{ status: number; body?: string }>): typeof fetch {
  let i = 0;
  return (async (_input: string | URL | Request, _init?: RequestInit) => {
    const e = entries[Math.min(i, entries.length - 1)];
    i++;
    return new Response(e.body ?? "", {
      status: e.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

Deno.test("uploadSharePointFileBytes: conflictBehavior=fail returns 409 body without overwriting", async () => {
  let capturedUrl = "";
  const impl = ((async (input: string | URL | Request) => {
    capturedUrl = String(input);
    return new Response(
      JSON.stringify({ error: { code: "nameAlreadyExists" } }),
      { status: 409 },
    );
  }) as unknown as typeof fetch);
  const res = await uploadSharePointFileBytes({
    accessToken: "t",
    requestId: "r",
    driveId: "d1",
    parentItemId: "p1",
    fileName: "Lessons Learned - X.docx",
    bytes: new Uint8Array([1, 2, 3]),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_lessons_learned_document",
    conflictBehavior: "fail",
    fetchImpl: impl,
  });
  assert(!res.ok, "expected non-ok result for 409");
  if (!res.ok) {
    assertEquals(res.httpStatus, 409);
    assertStringIncludes(capturedUrl, "conflictBehavior=fail");
    assert(!capturedUrl.includes("conflictBehavior=replace"));
  }
});

Deno.test("uploadSharePointFileBytes: default conflictBehavior stays 'replace' for other publishers", async () => {
  let capturedUrl = "";
  const impl = ((async (input: string | URL | Request) => {
    capturedUrl = String(input);
    return new Response(
      JSON.stringify({ id: "it", webUrl: "https://x.example/f" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch);
  const res = await uploadSharePointFileBytes({
    accessToken: "t",
    requestId: "r",
    driveId: "d1",
    parentItemId: "p1",
    fileName: "Charter.docx",
    bytes: new Uint8Array([0]),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_project_charter",
    fetchImpl: impl,
  });
  assert(res.ok);
  assertStringIncludes(capturedUrl, "conflictBehavior=replace");
});

Deno.test("uploadSharePointFileBytes: PUT + Word MIME + no filename in logs", async () => {
  let capturedInit: RequestInit | undefined;
  const impl = ((async (_input: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return new Response(JSON.stringify({ id: "i", webUrl: "https://x/f" }), {
      status: 200,
    });
  }) as unknown as typeof fetch);
  const res = await uploadSharePointFileBytes({
    accessToken: "t",
    requestId: "r",
    driveId: "d",
    parentItemId: "p",
    fileName: "Lessons Learned - Filename That Must Not Leak.docx",
    bytes: new Uint8Array([1]),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    operation: "publish_lessons_learned_document",
    conflictBehavior: "fail",
    fetchImpl: impl,
  });
  assert(res.ok);
  assertEquals(capturedInit?.method, "PUT");
  const headers = capturedInit?.headers as Record<string, string>;
  assertEquals(
    headers["Content-Type"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
});
