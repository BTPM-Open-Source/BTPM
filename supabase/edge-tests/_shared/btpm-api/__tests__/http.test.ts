// API-G.1A — Focused tests for request-ID and safe HTTP response foundation.

import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ApiHttpError,
  jsonResponse,
  logApiEvent,
  resolveRequestId,
  toSafeHttpErrorResponse,
} from "../../../../functions/_shared/btpm-api/http.ts";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/", { headers });
}

/** Lightweight request-header mock that bypasses fetch header sanitization. */
function makeRawHeaderRequest(name: string, value: string): Request {
  return {
    headers: {
      get(n: string): string | null {
        return n.toLowerCase() === name.toLowerCase() ? value : null;
      },
    },
  } as unknown as Request;
}

Deno.test("valid supplied request ID is trimmed and returned", () => {
  const req = makeRequest({ "X-Request-ID": "  abc-123_ID  " });
  assertEquals(resolveRequestId(req), "abc-123_ID");
});

Deno.test("missing request ID uses an injected deterministic UUID", () => {
  const req = makeRequest();
  const result = resolveRequestId(req, {
    randomUUID: () => "11111111-2222-3333-4444-555555555555",
  });
  assertEquals(result, "11111111-2222-3333-4444-555555555555");
});

Deno.test("blank request ID is rejected", () => {
  const req = makeRequest({ "X-Request-ID": "   " });
  try {
    resolveRequestId(req);
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "invalid_request_id");
    assertEquals(e.status, 400);
  }
});

Deno.test("internal whitespace is rejected", () => {
  const req = makeRequest({ "X-Request-ID": "abc def" });
  try {
    resolveRequestId(req);
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "invalid_request_id");
  }
});

Deno.test("commas are rejected", () => {
  const req = makeRequest({ "X-Request-ID": "abc,def" });
  try {
    resolveRequestId(req);
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "invalid_request_id");
  }
});

Deno.test("control characters are rejected", () => {
  const req = makeRawHeaderRequest("X-Request-ID", "abc\x01def");
  try {
    resolveRequestId(req);
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "invalid_request_id");
  }
});

Deno.test("values over 128 characters are rejected", () => {
  const req = makeRequest({ "X-Request-ID": "a".repeat(129) });
  try {
    resolveRequestId(req);
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "invalid_request_id");
  }
});

Deno.test("invalid dependency-generated ID is rejected", () => {
  const req = makeRequest();
  try {
    resolveRequestId(req, { randomUUID: () => "bad id with spaces" });
    throw new Error("expected throw");
  } catch (e) {
    assert(e instanceof ApiHttpError);
    assertEquals(e.code, "invalid_request_id");
  }
});

Deno.test("jsonResponse sets JSON content type, request ID and no-store", async () => {
  const rid = "req-1";
  const res = jsonResponse(200, { ok: true }, rid);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assertEquals(res.headers.get("X-Request-ID"), rid);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  assertEquals(await res.json(), { ok: true });
});

Deno.test("mandatory safety headers override conflicting supplied headers", () => {
  const rid = "req-2";
  const res = jsonResponse(200, {}, rid, {
    "Content-Type": "text/plain",
    "X-Request-ID": "attacker-supplied",
    "Cache-Control": "public, max-age=3600",
  });
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assertEquals(res.headers.get("X-Request-ID"), rid);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("unrelated supplied headers remain present", () => {
  const res = jsonResponse(200, {}, "req-3", { "X-Custom": "keep-me" });
  assertEquals(res.headers.get("X-Custom"), "keep-me");
});

Deno.test("existing ApiHttpError preserves its code and status", async () => {
  const err = new ApiHttpError("invalid_request_id");
  const res = toSafeHttpErrorResponse(err, "req-4");
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "invalid_request_id");
  assertEquals(body.error.message, "Invalid request identifier.");
  assertEquals(body.requestId, "req-4");
});

Deno.test("unknown errors map to internal_error", async () => {
  const res = toSafeHttpErrorResponse(new Error("boom secret"), "req-5");
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "internal_error");
  assertEquals(body.error.message, "Internal server error.");
  assertEquals(body.requestId, "req-5");
});

Deno.test("error JSON contains only error.code, error.message and requestId", async () => {
  const res = toSafeHttpErrorResponse(new Error("boom"), "req-6");
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), ["error", "requestId"]);
  assertEquals(Object.keys(body.error).sort(), ["code", "message"]);
});

Deno.test("internal causes and stack information are absent from serialized output", async () => {
  const cause = new Error("SECRET-STACK-TRACE-DO-NOT-LEAK");
  const err = new ApiHttpError("internal_error", cause);
  // Cause is retained as non-enumerable in memory but never serialized.
  const descriptor = Object.getOwnPropertyDescriptor(err, "internalCause");
  assert(descriptor);
  assertStrictEquals(descriptor!.enumerable, false);

  const res = toSafeHttpErrorResponse(err, "req-7");
  const raw = await res.text();
  assert(!raw.includes("SECRET-STACK-TRACE-DO-NOT-LEAK"));
  assert(!raw.includes("stack"));
  assert(!raw.includes("internalCause"));
  const parsed = JSON.parse(raw);
  assertEquals(Object.keys(parsed).sort(), ["error", "requestId"]);
});

// ---------------------------------------------------------------------------
// API-G.1B — readBoundedJson focused tests
// ---------------------------------------------------------------------------

import { readBoundedJson } from "../../../../functions/_shared/btpm-api/http.ts";

function jsonReq(body: string | Uint8Array | null, headers: Record<string, string> = {}, opts: { noBody?: boolean } = {}): Request {
  const init: RequestInit = { method: "POST", headers };
  if (!opts.noBody && body !== null) init.body = body as BodyInit;
  return new Request("http://localhost/", init);
}

function streamReq(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
  opts: { fail?: boolean; onCancel?: () => void } = {},
): Request {
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (opts.fail) {
        controller.error(new Error("SECRET-STREAM-BOOM"));
        return;
      }
      const c = chunks.shift();
      if (c === undefined) controller.close();
      else controller.enqueue(c);
    },
    cancel() {
      if (opts.onCancel) opts.onCancel();
    },
  });
  return new Request("http://localhost/", {
    method: "POST",
    headers,
    body: stream,
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<ApiHttpError> {
  try {
    await promise;
  } catch (e) {
    assert(e instanceof ApiHttpError, `expected ApiHttpError, got ${e}`);
    assertEquals((e as ApiHttpError).code, code);
    return e as ApiHttpError;
  }
  throw new Error(`expected throw with code ${code}`);
}

Deno.test("readBoundedJson accepts application/json", async () => {
  const req = jsonReq('{"a":1}', { "Content-Type": "application/json" });
  assertEquals(await readBoundedJson(req, 1024), { a: 1 });
});

Deno.test("readBoundedJson accepts parameterized and mixed-case JSON content type", async () => {
  const req = jsonReq('{"b":2}', { "Content-Type": "  Application/JSON ; charset=utf-8 " });
  assertEquals(await readBoundedJson(req, 1024), { b: 2 });
});

Deno.test("readBoundedJson rejects missing content type", async () => {
  const req = new Request("http://localhost/", { method: "POST", body: '{"a":1}' });
  // Fetch may auto-set text/plain; force absence via mocked headers
  const mock = {
    headers: { get: (n: string) => n.toLowerCase() === "content-type" ? null : null },
    body: req.body,
  } as unknown as Request;
  await expectCode(readBoundedJson(mock, 1024), "unsupported_media_type");
});

Deno.test("readBoundedJson rejects non-JSON content type", async () => {
  const req = jsonReq('{"a":1}', { "Content-Type": "text/plain" });
  await expectCode(readBoundedJson(req, 1024), "unsupported_media_type");
});

Deno.test("readBoundedJson rejects text/json suffix variants", async () => {
  const req = jsonReq('{"a":1}', { "Content-Type": "text/json" });
  await expectCode(readBoundedJson(req, 1024), "unsupported_media_type");
});

Deno.test("readBoundedJson rejects malformed Content-Length", async () => {
  const req = jsonReq('{"a":1}', { "Content-Type": "application/json", "Content-Length": "abc" });
  await expectCode(readBoundedJson(req, 1024), "invalid_content_length");
});

Deno.test("readBoundedJson rejects negative Content-Length", async () => {
  const req = { headers: { get: (n: string) => ({ "content-type": "application/json", "content-length": "-1" } as Record<string,string>)[n.toLowerCase()] ?? null }, body: new ReadableStream() } as unknown as Request;
  await expectCode(readBoundedJson(req, 1024), "invalid_content_length");
});

Deno.test("readBoundedJson rejects fractional Content-Length", async () => {
  const req = { headers: { get: (n: string) => ({ "content-type": "application/json", "content-length": "1.5" } as Record<string,string>)[n.toLowerCase()] ?? null }, body: new ReadableStream() } as unknown as Request;
  await expectCode(readBoundedJson(req, 1024), "invalid_content_length");
});

Deno.test("readBoundedJson rejects unsafe Content-Length", async () => {
  const unsafe = (Number.MAX_SAFE_INTEGER + 10).toString();
  const req = { headers: { get: (n: string) => ({ "content-type": "application/json", "content-length": unsafe } as Record<string,string>)[n.toLowerCase()] ?? null }, body: new ReadableStream() } as unknown as Request;
  await expectCode(readBoundedJson(req, 1024), "invalid_content_length");
});

Deno.test("readBoundedJson rejects comma-combined Content-Length", async () => {
  const req = { headers: { get: (n: string) => ({ "content-type": "application/json", "content-length": "10, 10" } as Record<string,string>)[n.toLowerCase()] ?? null }, body: new ReadableStream() } as unknown as Request;
  await expectCode(readBoundedJson(req, 1024), "invalid_content_length");
});

Deno.test("readBoundedJson rejects oversized Content-Length before touching body", async () => {
  let bodyAccessed = false;
  const stream = new ReadableStream<Uint8Array>({ pull() {} });
  const req = {
    headers: { get: (n: string) => ({ "content-type": "application/json", "content-length": "10000" } as Record<string,string>)[n.toLowerCase()] ?? null },
    get body() { bodyAccessed = true; return stream; },
  } as unknown as Request;
  await expectCode(readBoundedJson(req, 10), "request_too_large");
  assertEquals(bodyAccessed, false);
});

Deno.test("readBoundedJson rejects streamed body larger than maxBytes without Content-Length", async () => {
  const req = streamReq(
    [new Uint8Array(5), new Uint8Array(5), new Uint8Array(5)],
    { "Content-Type": "application/json" },
  );
  await expectCode(readBoundedJson(req, 10), "request_too_large");
});

Deno.test("readBoundedJson best-effort cancels reader when body exceeds limit", async () => {
  let cancelled = false;
  const req = streamReq(
    [new Uint8Array(20)],
    { "Content-Type": "application/json" },
    { onCancel: () => { cancelled = true; } },
  );
  await expectCode(readBoundedJson(req, 10), "request_too_large");
  assertEquals(cancelled, true);
});

Deno.test("readBoundedJson accepts body exactly equal to maxBytes", async () => {
  const payload = '{"x":1}'; // 7 bytes
  const req = jsonReq(payload, { "Content-Type": "application/json" });
  assertEquals(await readBoundedJson(req, 7), { x: 1 });
});

Deno.test("readBoundedJson enforces UTF-8 byte count, not JS char count", async () => {
  // "€" is 3 UTF-8 bytes but 1 JS char. Wrap in JSON string: "\"€\"" = 5 bytes.
  const bytes = new TextEncoder().encode('"€"');
  assertEquals(bytes.byteLength, 5);
  const req1 = jsonReq(bytes, { "Content-Type": "application/json" });
  await expectCode(readBoundedJson(req1, 4), "request_too_large");
  const req2 = jsonReq(bytes, { "Content-Type": "application/json" });
  assertEquals(await readBoundedJson(req2, 5), "€");
});

Deno.test("readBoundedJson parses objects, arrays, scalars and null", async () => {
  for (const [payload, expected] of [
    ['{"a":1}', { a: 1 }],
    ['[1,2,3]', [1, 2, 3]],
    ['42', 42],
    ['"hi"', "hi"],
    ['true', true],
    ['null', null],
  ] as const) {
    const req = jsonReq(payload, { "Content-Type": "application/json" });
    assertEquals(await readBoundedJson(req, 1024), expected);
  }
});

Deno.test("readBoundedJson rejects null body as invalid_json", async () => {
  const req = { headers: { get: (n: string) => n.toLowerCase() === "content-type" ? "application/json" : null }, body: null } as unknown as Request;
  await expectCode(readBoundedJson(req, 1024), "invalid_json");
});

Deno.test("readBoundedJson rejects zero-byte body as invalid_json", async () => {
  const req = streamReq([], { "Content-Type": "application/json" });
  await expectCode(readBoundedJson(req, 1024), "invalid_json");
});

Deno.test("readBoundedJson rejects whitespace-only body as invalid_json", async () => {
  const req = jsonReq("   \n\t ", { "Content-Type": "application/json" });
  await expectCode(readBoundedJson(req, 1024), "invalid_json");
});

Deno.test("readBoundedJson rejects malformed JSON as invalid_json", async () => {
  const req = jsonReq('{"a":', { "Content-Type": "application/json" });
  await expectCode(readBoundedJson(req, 1024), "invalid_json");
});

Deno.test("readBoundedJson rejects invalid UTF-8 as invalid_json", async () => {
  const bad = new Uint8Array([0xff, 0xfe, 0xfd]);
  const req = jsonReq(bad, { "Content-Type": "application/json" });
  await expectCode(readBoundedJson(req, 1024), "invalid_json");
});

Deno.test("readBoundedJson maps body-stream failure to internal_error", async () => {
  const req = streamReq([], { "Content-Type": "application/json" }, { fail: true });
  const err = await expectCode(readBoundedJson(req, 1024), "internal_error");
  // Serialized form must not leak the underlying error.
  const res = toSafeHttpErrorResponse(err, "req-x");
  const raw = await res.text();
  assert(!raw.includes("SECRET-STREAM-BOOM"));
});

Deno.test("readBoundedJson serialized errors omit body text and raw bytes", async () => {
  const req = jsonReq('{"SECRET-BODY-TEXT":true,', { "Content-Type": "application/json" });
  const err = await expectCode(readBoundedJson(req, 1024), "invalid_json");
  const res = toSafeHttpErrorResponse(err, "req-y");
  const raw = await res.text();
  assert(!raw.includes("SECRET-BODY-TEXT"));
  const parsed = JSON.parse(raw);
  assertEquals(Object.keys(parsed).sort(), ["error", "requestId"]);
});

Deno.test("readBoundedJson rejects invalid maxBytes values as internal_error", async () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity, "10" as unknown as number, null as unknown as number, undefined as unknown as number]) {
    const req = jsonReq('{"a":1}', { "Content-Type": "application/json" });
    await expectCode(readBoundedJson(req, bad), "internal_error");
  }
});

// ---------------------------------------------------------------------------
// API-G.1B Correction — Preserve existing ApiHttpError from body streams
// ---------------------------------------------------------------------------

function bodyReq(body: ReadableStream<Uint8Array> | { getReader: () => unknown }): Request {
  return {
    headers: {
      get: (n: string) => n.toLowerCase() === "content-type" ? "application/json" : null,
    },
    body,
  } as unknown as Request;
}

Deno.test("body.getReader ApiHttpError is rethrown as same instance", async () => {
  const marker = new ApiHttpError("invalid_json");
  const req = bodyReq({ getReader: () => { throw marker; } });
  try {
    await readBoundedJson(req, 1024);
    throw new Error("expected throw");
  } catch (e) {
    assertStrictEquals(e, marker);
  }
});

Deno.test("body.getReader ordinary error maps to internal_error without leaking cause", async () => {
  const req = bodyReq({ getReader: () => { throw new Error("SECRET-ACQUIRE-BOOM"); } });
  const err = await expectCode(readBoundedJson(req, 1024), "internal_error");
  const res = toSafeHttpErrorResponse(err, "req-acq");
  const raw = await res.text();
  assert(!raw.includes("SECRET-ACQUIRE-BOOM"));
});

Deno.test("reader.read ApiHttpError is rethrown as same instance", async () => {
  const marker = new ApiHttpError("request_too_large");
  let cancelled = false;
  const fakeReader = {
    read: () => Promise.reject(marker),
    cancel: () => { cancelled = true; return Promise.resolve(); },
    releaseLock: () => {},
  };
  const req = bodyReq({ getReader: () => fakeReader });
  try {
    await readBoundedJson(req, 1024);
    throw new Error("expected throw");
  } catch (e) {
    assertStrictEquals(e, marker);
  }
  assertEquals(cancelled, true);
});

Deno.test("reader.read ordinary error maps to internal_error and hides cause", async () => {
  const fakeReader = {
    read: () => Promise.reject(new Error("SECRET-READ-BOOM")),
    cancel: () => Promise.resolve(),
    releaseLock: () => {},
  };
  const req = bodyReq({ getReader: () => fakeReader });
  const err = await expectCode(readBoundedJson(req, 1024), "internal_error");
  const res = toSafeHttpErrorResponse(err, "req-read");
  const raw = await res.text();
  assert(!raw.includes("SECRET-READ-BOOM"));
});

// =============================================================================
// API-G.1D — withApiTimeout focused tests
// =============================================================================

import { withApiTimeout } from "../../../../functions/_shared/btpm-api/http.ts";

async function expectApiError(
  p: Promise<unknown>,
  code: string,
): Promise<ApiHttpError> {
  try {
    await p;
  } catch (e) {
    assert(e instanceof ApiHttpError, `expected ApiHttpError, got ${e}`);
    assertEquals((e as ApiHttpError).code, code);
    return e as ApiHttpError;
  }
  throw new Error(`expected rejection with code ${code}`);
}

for (const bad of [0, -1, -100, 1.5, 0.1, NaN, Infinity, -Infinity]) {
  Deno.test(`withApiTimeout rejects invalid timeoutMs=${bad}`, async () => {
    await expectApiError(
      withApiTimeout(bad as number, async () => 1),
      "internal_error",
    );
  });
}

for (const bad of ["50", null, undefined, {}, []]) {
  Deno.test(`withApiTimeout rejects non-number timeoutMs=${JSON.stringify(bad)}`, async () => {
    await expectApiError(
      // deno-lint-ignore no-explicit-any
      withApiTimeout(bad as any, async () => 1),
      "internal_error",
    );
  });
}

Deno.test("withApiTimeout invokes operation exactly once with AbortSignal", async () => {
  let calls = 0;
  let seenSignal: AbortSignal | undefined;
  const result = await withApiTimeout(1000, async (signal) => {
    calls++;
    seenSignal = signal;
    return "ok";
  });
  assertEquals(calls, 1);
  assertEquals(result, "ok");
  assert(seenSignal instanceof AbortSignal);
  assertEquals(seenSignal!.aborted, false);
});

Deno.test("withApiTimeout returns operation value unchanged", async () => {
  const obj = { a: 1 };
  const out = await withApiTimeout(500, async () => obj);
  assertStrictEquals(out, obj);
});

Deno.test("successful operation clears timer; signal not aborted after original timeout period", async () => {
  let capturedSignal: AbortSignal | undefined;
  await withApiTimeout(30, async (signal) => {
    capturedSignal = signal;
    return 42;
  });
  await new Promise((r) => setTimeout(r, 80));
  assertEquals(capturedSignal!.aborted, false);
});

Deno.test("timeout expiry rejects with request_timeout and aborts the exact signal", async () => {
  let capturedSignal: AbortSignal | undefined;
  const p = withApiTimeout(20, (signal) => {
    capturedSignal = signal;
    return new Promise<never>(() => {}); // never resolves
  });
  const err = await expectApiError(p, "request_timeout");
  assertEquals(err.status, 504);
  assertEquals(err.publicMessage, "Request timed out.");
  assert(capturedSignal!.aborted);
});

Deno.test("synchronously thrown ApiHttpError is preserved as same instance", async () => {
  const original = new ApiHttpError("invalid_json");
  try {
    await withApiTimeout(100, () => {
      throw original;
    });
    throw new Error("expected throw");
  } catch (e) {
    assertStrictEquals(e, original);
  }
});

Deno.test("asynchronously rejected ApiHttpError is preserved as same instance", async () => {
  const original = new ApiHttpError("invalid_content_length");
  try {
    await withApiTimeout(100, async () => {
      throw original;
    });
    throw new Error("expected throw");
  } catch (e) {
    assertStrictEquals(e, original);
  }
});

Deno.test("synchronous ordinary error maps to internal_error", async () => {
  const err = await expectApiError(
    withApiTimeout(100, () => {
      throw new Error("SECRET-SYNC-BOOM");
    }),
    "internal_error",
  );
  const res = toSafeHttpErrorResponse(err, "req-1");
  const raw = await res.text();
  assert(!raw.includes("SECRET-SYNC-BOOM"));
});

Deno.test("asynchronous ordinary rejection maps to internal_error", async () => {
  const err = await expectApiError(
    withApiTimeout(100, async () => {
      throw new Error("SECRET-ASYNC-BOOM");
    }),
    "internal_error",
  );
  const res = toSafeHttpErrorResponse(err, "req-2");
  const raw = await res.text();
  assert(!raw.includes("SECRET-ASYNC-BOOM"));
});

Deno.test("timers cleared after operation rejection; signal not aborted later", async () => {
  let capturedSignal: AbortSignal | undefined;
  try {
    await withApiTimeout(50, async (signal) => {
      capturedSignal = signal;
      throw new Error("boom");
    });
  } catch {
    // expected
  }
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(capturedSignal!.aborted, false);
});

Deno.test("timeout error safe serialization exposes no cause/stack/duration", async () => {
  const err = await expectApiError(
    withApiTimeout(15, () => new Promise<never>(() => {})),
    "request_timeout",
  );
  const res = toSafeHttpErrorResponse(err, "req-t");
  assertEquals(res.status, 504);
  const body = await res.json();
  assertEquals(body, {
    error: { code: "request_timeout", message: "Request timed out." },
    requestId: "req-t",
  });
});

Deno.test("internal_error safe serialization from timeout wrapping exposes no cause", async () => {
  const err = await expectApiError(
    withApiTimeout(50, async () => {
      throw new Error("SECRET-INNER-CAUSE-XYZ");
    }),
    "internal_error",
  );
  const res = toSafeHttpErrorResponse(err, "req-i");
  const raw = await res.text();
  assert(!raw.includes("SECRET-INNER-CAUSE-XYZ"));
  assert(!raw.includes("stack"));
});

Deno.test("operation rejecting after timeout does not produce unhandled rejection", async () => {
  let unhandled = 0;
  const handler = (e: PromiseRejectionEvent | Event) => {
    unhandled++;
    // deno-lint-ignore no-explicit-any
    (e as any).preventDefault?.();
  };
  // deno-lint-ignore no-explicit-any
  (globalThis as any).addEventListener?.("unhandledrejection", handler);

  const p = withApiTimeout(15, async () => {
    await new Promise((r) => setTimeout(r, 80));
    throw new Error("late-boom");
  });
  await expectApiError(p, "request_timeout");
  await new Promise((r) => setTimeout(r, 150));

  // deno-lint-ignore no-explicit-any
  (globalThis as any).removeEventListener?.("unhandledrejection", handler);
  assertEquals(unhandled, 0);
});

// ---------------------------------------------------------------------------
// API-G.1E — logApiEvent focused tests
// ---------------------------------------------------------------------------

interface CapturedLog {
  method: "log" | "warn" | "error";
  args: unknown[];
}

function captureConsole(fn: () => void): CapturedLog[] {
  const captured: CapturedLog[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  try {
    console.log = (...args: unknown[]) => {
      captured.push({ method: "log", args });
    };
    console.warn = (...args: unknown[]) => {
      captured.push({ method: "warn", args });
    };
    console.error = (...args: unknown[]) => {
      captured.push({ method: "error", args });
    };
    fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  return captured;
}

const PROHIBITED_SUBSTRINGS = [
  "SECRET-BODY",
  "SECRET-HEADER",
  "SECRET-TOKEN",
  "SECRET-AUTH",
  "SECRET-URL",
  "SECRET-QUERY",
  "SECRET-EMAIL",
  "SECRET-CLAIMS",
  "SECRET-DB",
  "SECRET-SQL",
  "SECRET-STACK",
  "SECRET-CAUSE",
  "SECRET-ENV",
  "SECRET-META",
];

Deno.test("logApiEvent info uses console.log with a single JSON string", () => {
  const captured = captureConsole(() => {
    logApiEvent({
      level: "info",
      event: "api.request.received",
      requestId: "req-1",
    });
  });
  assertEquals(captured.length, 1);
  assertEquals(captured[0].method, "log");
  assertEquals(captured[0].args.length, 1);
  assertEquals(typeof captured[0].args[0], "string");
  const parsed = JSON.parse(captured[0].args[0] as string);
  assertEquals(parsed, {
    level: "info",
    event: "api.request.received",
    requestId: "req-1",
  });
});

Deno.test("logApiEvent warn uses console.warn", () => {
  const captured = captureConsole(() => {
    logApiEvent({
      level: "warn",
      event: "api.request.rejected",
      requestId: "req-2",
    });
  });
  assertEquals(captured.length, 1);
  assertEquals(captured[0].method, "warn");
  assertEquals(captured[0].args.length, 1);
});

Deno.test("logApiEvent error uses console.error", () => {
  const captured = captureConsole(() => {
    logApiEvent({
      level: "error",
      event: "api.request.failed",
      requestId: "req-3",
    });
  });
  assertEquals(captured.length, 1);
  assertEquals(captured[0].method, "error");
  assertEquals(captured[0].args.length, 1);
});

Deno.test("logApiEvent emits declared required and valid optional fields", () => {
  const captured = captureConsole(() => {
    logApiEvent({
      level: "info",
      event: "api.request.completed",
      requestId: "req-4",
      method: "POST",
      routeId: "collection.projects.list",
      status: 200,
      durationMs: 42,
      code: "internal_error",
    });
  });
  const parsed = JSON.parse(captured[0].args[0] as string);
  assertEquals(parsed, {
    level: "info",
    event: "api.request.completed",
    requestId: "req-4",
    method: "POST",
    routeId: "collection.projects.list",
    status: 200,
    durationMs: 42,
    code: "internal_error",
  });
});

Deno.test("logApiEvent ignores unknown extra runtime properties", () => {
  const captured = captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent({
      level: "info",
      event: "api.request.received",
      requestId: "req-5",
      body: "SECRET-BODY-VALUE",
      headers: { authorization: "SECRET-HEADER-VALUE" },
      token: "SECRET-TOKEN-VALUE",
      claims: { sub: "SECRET-CLAIMS-VALUE" },
      url: "https://example.com/x?y=SECRET-URL-VALUE",
      query: "q=SECRET-QUERY-VALUE",
      email: "SECRET-EMAIL@example.com",
      stack: "SECRET-STACK-TRACE",
      sql: "SELECT SECRET-SQL",
      cause: "SECRET-CAUSE-VALUE",
      metadata: { foo: "SECRET-META-VALUE" },
    } as any);
  });
  const line = captured[0].args[0] as string;
  const parsed = JSON.parse(line);
  assertEquals(Object.keys(parsed).sort(), ["event", "level", "requestId"]);
  for (const s of [
    "SECRET-BODY-VALUE",
    "SECRET-HEADER-VALUE",
    "SECRET-TOKEN-VALUE",
    "SECRET-CLAIMS-VALUE",
    "SECRET-URL-VALUE",
    "SECRET-QUERY-VALUE",
    "SECRET-EMAIL",
    "SECRET-STACK-TRACE",
    "SECRET-SQL",
    "SECRET-CAUSE-VALUE",
    "SECRET-META-VALUE",
  ]) {
    assert(!line.includes(s), `line must not include ${s}`);
  }
});

Deno.test("logApiEvent invalid level emits safe fallback via console.error", () => {
  const captured = captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent({
      level: "trace" as any,
      event: "api.request.received",
      requestId: "req-6",
    });
  });
  assertEquals(captured.length, 1);
  assertEquals(captured[0].method, "error");
  const parsed = JSON.parse(captured[0].args[0] as string);
  assertEquals(parsed, {
    level: "error",
    event: "api.logging.invalid",
    requestId: "unavailable",
    code: "internal_error",
  });
});

Deno.test("logApiEvent invalid event emits safe fallback", () => {
  const captured = captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent({
      level: "info",
      event: "api.unknown.event" as any,
      requestId: "req-7",
    });
  });
  const parsed = JSON.parse(captured[0].args[0] as string);
  assertEquals(parsed.event, "api.logging.invalid");
  assertEquals(parsed.requestId, "unavailable");
});

Deno.test("logApiEvent invalid requestId emits safe fallback without leaking value", () => {
  const captured = captureConsole(() => {
    logApiEvent({
      level: "info",
      event: "api.request.received",
      // spaces are not allowed by REQUEST_ID_PATTERN
      requestId: "SECRET-BAD REQID VALUE",
    });
  });
  const line = captured[0].args[0] as string;
  assert(!line.includes("SECRET-BAD"));
  const parsed = JSON.parse(line);
  assertEquals(parsed, {
    level: "error",
    event: "api.logging.invalid",
    requestId: "unavailable",
    code: "internal_error",
  });
});

Deno.test("logApiEvent invalid method is omitted", () => {
  const captured = captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent({
      level: "info",
      event: "api.request.received",
      requestId: "req-8",
      method: "get" as any,
    });
  });
  const parsed = JSON.parse(captured[0].args[0] as string);
  assertEquals(parsed.method, undefined);
  assert(!("method" in parsed));
});

Deno.test("logApiEvent unknown method is omitted", () => {
  const captured = captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent({
      level: "info",
      event: "api.request.received",
      requestId: "req-8b",
      method: "CONNECT" as any,
    });
  });
  const parsed = JSON.parse(captured[0].args[0] as string);
  assert(!("method" in parsed));
});

Deno.test("logApiEvent valid routeId values are retained", () => {
  for (const rid of ["version.get", "capabilities.get", "collection.projects.list"]) {
    const captured = captureConsole(() => {
      logApiEvent({
        level: "info",
        event: "api.request.received",
        requestId: "req-9",
        routeId: rid,
      });
    });
    const parsed = JSON.parse(captured[0].args[0] as string);
    assertEquals(parsed.routeId, rid);
  }
});

Deno.test("logApiEvent routeId with disallowed characters or length is omitted", () => {
  const invalid: string[] = [
    "/version",
    "route?x=1",
    "route#frag",
    "has space",
    "line\nfeed",
    "tab\tin",
    "\u0007bell",
    "a".repeat(129),
    "",
  ];
  for (const rid of invalid) {
    const captured = captureConsole(() => {
      logApiEvent({
        level: "info",
        event: "api.request.received",
        requestId: "req-10",
        routeId: rid,
      });
    });
    const parsed = JSON.parse(captured[0].args[0] as string);
    assert(!("routeId" in parsed), `must omit routeId=${JSON.stringify(rid)}`);
  }
});

Deno.test("logApiEvent invalid status values are omitted", () => {
  // deno-lint-ignore no-explicit-any
  const cases: any[] = [99, 600, 200.5, NaN, Infinity, -1, "200"];
  for (const s of cases) {
    const captured = captureConsole(() => {
      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId: "req-11",
        status: s,
      });
    });
    const parsed = JSON.parse(captured[0].args[0] as string);
    assert(!("status" in parsed), `must omit status=${String(s)}`);
  }
});

Deno.test("logApiEvent valid status is retained", () => {
  const captured = captureConsole(() => {
    logApiEvent({
      level: "info",
      event: "api.request.completed",
      requestId: "req-11b",
      status: 100,
    });
  });
  const parsed = JSON.parse(captured[0].args[0] as string);
  assertEquals(parsed.status, 100);
});

Deno.test("logApiEvent invalid durationMs values are omitted", () => {
  // deno-lint-ignore no-explicit-any
  const cases: any[] = [-1, 1.5, NaN, Infinity, "10", Number.MAX_SAFE_INTEGER + 1];
  for (const d of cases) {
    const captured = captureConsole(() => {
      logApiEvent({
        level: "info",
        event: "api.request.completed",
        requestId: "req-12",
        durationMs: d,
      });
    });
    const parsed = JSON.parse(captured[0].args[0] as string);
    assert(!("durationMs" in parsed), `must omit durationMs=${String(d)}`);
  }
});

Deno.test("logApiEvent retains all declared ApiHttpErrorCode values", () => {
  const codes = [
    "invalid_request_id",
    "internal_error",
    "unsupported_media_type",
    "invalid_content_length",
    "request_too_large",
    "invalid_json",
    "cors_origin_denied",
    "request_timeout",
  ] as const;
  for (const c of codes) {
    const captured = captureConsole(() => {
      logApiEvent({
        level: "error",
        event: "api.request.failed",
        requestId: "req-13",
        code: c,
      });
    });
    const parsed = JSON.parse(captured[0].args[0] as string);
    assertEquals(parsed.code, c);
  }
});

// API-G.2B — safe authorization error code.

Deno.test("not_authorized maps to status 403 and exact public message", () => {
  const err = new ApiHttpError("not_authorized");
  assertEquals(err.code, "not_authorized");
  assertEquals(err.status, 403);
  assertEquals(err.publicMessage, "Not authorized.");
  assertEquals(err.message, "Not authorized.");
});

Deno.test("not_authorized safe response shape exposes only code, message and request id", async () => {
  const err = new ApiHttpError("not_authorized", {
    message: "permission denied for function api_v1_get_me",
    code: "42501",
  });
  const response = toSafeHttpErrorResponse(err, "req-not-authorized");
  assertEquals(response.status, 403);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/json; charset=utf-8",
  );
  const body = await response.json();
  assertEquals(body, {
    error: { code: "not_authorized", message: "Not authorized." },
    requestId: "req-not-authorized",
  });
  const text = JSON.stringify(body);
  assert(!text.includes("42501"));
  assert(!text.includes("permission denied"));
});

Deno.test("not_authorized is an accepted log event code", () => {
  const captured = captureConsole(() => {
    logApiEvent({
      level: "warn",
      event: "api.request.rejected",
      requestId: "req-14",
      status: 403,
      code: "not_authorized",
    });
  });
  const parsed = JSON.parse(captured[0].args[0] as string);
  assertEquals(parsed.code, "not_authorized");
  assertEquals(parsed.status, 403);
});

Deno.test("existing error codes preserve status and message", () => {
  const expected: Array<[string, number, string]> = [
    ["invalid_request_id", 400, "Invalid request identifier."],
    ["internal_error", 500, "Internal server error."],
    ["unsupported_media_type", 415, "Content-Type must be application/json."],
    ["invalid_content_length", 400, "Invalid Content-Length header."],
    ["request_too_large", 413, "Request body is too large."],
    ["invalid_json", 400, "Request body must contain valid JSON."],
    ["cors_origin_denied", 403, "Origin is not allowed."],
    ["request_timeout", 504, "Request timed out."],
    ["rate_limit_exceeded", 429, "Rate limit exceeded."],
    ["invalid_request", 400, "Request validation failed."],
    ["route_not_found", 404, "Route not found."],
    ["api_unavailable", 503, "API is unavailable."],
  ];
  for (const [code, status, message] of expected) {
    // deno-lint-ignore no-explicit-any
    const err = new ApiHttpError(code as any);
    assertEquals(err.status, status);
    assertEquals(err.publicMessage, message);
  }
});

Deno.test("logApiEvent unknown error code strings are omitted", () => {
  const captured = captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent({
      level: "error",
      event: "api.request.failed",
      requestId: "req-14",
      code: "not_a_real_code" as any,
    });
  });
  const parsed = JSON.parse(captured[0].args[0] as string);
  assert(!("code" in parsed));
});

Deno.test("logApiEvent does not mutate the input event object", () => {
  const input: Record<string, unknown> = {
    level: "info",
    event: "api.request.received",
    requestId: "req-15",
    method: "GET",
    routeId: "version.get",
    status: 200,
    durationMs: 5,
    code: "internal_error",
    extra: "SECRET-META-KEEP",
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent(input as any);
  });
  assertEquals(input, snapshot);
});

Deno.test("logApiEvent serialized output never contains prohibited sensitive substrings", () => {
  const captured = captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent({
      level: "info",
      event: "api.request.received",
      requestId: "req-16",
      body: "SECRET-BODY",
      headers: "SECRET-HEADER",
      token: "SECRET-TOKEN",
      authorization: "SECRET-AUTH",
      url: "SECRET-URL",
      query: "SECRET-QUERY",
      email: "SECRET-EMAIL",
      claims: "SECRET-CLAIMS",
      db: "SECRET-DB",
      sql: "SECRET-SQL",
      stack: "SECRET-STACK",
      cause: "SECRET-CAUSE",
      env: "SECRET-ENV",
      metadata: "SECRET-META",
    } as any);
  });
  const line = captured[0].args[0] as string;
  for (const s of PROHIBITED_SUBSTRINGS) {
    assert(!line.includes(s), `serialized line must not include ${s}`);
  }
});

Deno.test("logApiEvent handles non-object input via safe fallback", () => {
  const captured = captureConsole(() => {
    // deno-lint-ignore no-explicit-any
    logApiEvent(null as any);
    // deno-lint-ignore no-explicit-any
    logApiEvent(undefined as any);
    // deno-lint-ignore no-explicit-any
    logApiEvent("SECRET-STRING" as any);
  });
  assertEquals(captured.length, 3);
  for (const c of captured) {
    assertEquals(c.method, "error");
    const parsed = JSON.parse(c.args[0] as string);
    assertEquals(parsed, {
      level: "error",
      event: "api.logging.invalid",
      requestId: "unavailable",
      code: "internal_error",
    });
    assert(!(c.args[0] as string).includes("SECRET-STRING"));
  }
});

// -----------------------------------------------------------------------------
// API-G.1J — route_not_found and api_unavailable error codes.
// -----------------------------------------------------------------------------

Deno.test("route_not_found has status 404 and public message", () => {
  const err = new ApiHttpError("route_not_found");
  assertEquals(err.status, 404);
  assertEquals(err.publicMessage, "Route not found.");
  assertEquals(err.message, "Route not found.");
});

Deno.test("api_unavailable has status 503 and public message", () => {
  const err = new ApiHttpError("api_unavailable");
  assertEquals(err.status, 503);
  assertEquals(err.publicMessage, "API is unavailable.");
  assertEquals(err.message, "API is unavailable.");
});

Deno.test("route_not_found safe serialization exposes only stable fields", () => {
  const err = new ApiHttpError("route_not_found", {
    method: "GET",
    path: "/v1/secret",
    switch: "true",
    internal: "cause-string",
  });
  const safe = err.toSafeJSON("req-abc");
  assertEquals(safe, {
    error: { code: "route_not_found", message: "Route not found." },
    requestId: "req-abc",
  });
  const s = JSON.stringify(safe);
  assert(!s.includes("GET"));
  assert(!s.includes("/v1/secret"));
  assert(!s.includes("cause-string"));
  assert(!s.includes("switch"));
});

Deno.test("api_unavailable safe serialization exposes only stable fields", () => {
  const err = new ApiHttpError("api_unavailable", {
    apiEnabled: false,
    readsEnabled: true,
    routeId: "version.get",
  });
  const safe = err.toSafeJSON("req-xyz");
  assertEquals(safe, {
    error: { code: "api_unavailable", message: "API is unavailable." },
    requestId: "req-xyz",
  });
  const s = JSON.stringify(safe);
  assert(!s.includes("apiEnabled"));
  assert(!s.includes("readsEnabled"));
  assert(!s.includes("version.get"));
});

Deno.test("toSafeHttpErrorResponse maps route_not_found to a 404 JSON response", async () => {
  const res = toSafeHttpErrorResponse(
    new ApiHttpError("route_not_found"),
    "req-1",
  );
  assertEquals(res.status, 404);
  assertEquals(await res.json(), {
    error: { code: "route_not_found", message: "Route not found." },
    requestId: "req-1",
  });
});

Deno.test("toSafeHttpErrorResponse maps api_unavailable to a 503 JSON response", async () => {
  const res = toSafeHttpErrorResponse(
    new ApiHttpError("api_unavailable"),
    "req-2",
  );
  assertEquals(res.status, 503);
  assertEquals(await res.json(), {
    error: { code: "api_unavailable", message: "API is unavailable." },
    requestId: "req-2",
  });
});

Deno.test("logging sanitizer accepts route_not_found and api_unavailable codes", () => {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines: string[] = [];
  const capture = (s: unknown) => lines.push(String(s));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    logApiEvent({
      level: "warn",
      event: "api.request.rejected",
      requestId: "req-nf",
      code: "route_not_found",
    });
    logApiEvent({
      level: "warn",
      event: "api.request.rejected",
      requestId: "req-un",
      code: "api_unavailable",
    });
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  assertEquals(lines.length, 2);
  const first = JSON.parse(lines[0]);
  const second = JSON.parse(lines[1]);
  assertStrictEquals(first.code, "route_not_found");
  assertStrictEquals(second.code, "api_unavailable");
});

