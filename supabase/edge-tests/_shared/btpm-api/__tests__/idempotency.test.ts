// API-F.4 — Focused Deno tests for idempotency and execution-context builder.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  canonicalizePayload,
  hashCanonicalPayload,
  IdempotencyValidationError,
  readIdempotencyKey,
} from "../../../../functions/_shared/btpm-api/idempotency.ts";
import {
  buildExecutionContext,
  ExecutionContextError,
} from "../../../../functions/_shared/btpm-api/buildExecutionContext.ts";
import type { AuthenticatedApiContext } from "../../../../functions/_shared/btpm-api/authenticateApiRequest.ts";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://example.test/", { headers });
}

function baseAuthCtx(
  overrides: Partial<{
    tokenUserId: string;
    clientUserId: string;
    tokenClientId: string;
    oauthClientId: string;
    apiClientId: string;
    policyVersionId: string;
  }> = {},
): AuthenticatedApiContext {
  const tokenUserId = overrides.tokenUserId ?? "user-1";
  const clientUserId = overrides.clientUserId ?? "user-1";
  const tokenClientId = overrides.tokenClientId ?? "oauth-client-1";
  const oauthClientId = overrides.oauthClientId ?? "oauth-client-1";
  return Object.freeze({
    token: Object.freeze({
      userId: tokenUserId,
      clientId: tokenClientId,
      issuer: "iss",
      audiences: Object.freeze(["aud"]),
      expiresAt: 9999999999,
    }),
    client: Object.freeze({
      userId: clientUserId,
      apiClientId: overrides.apiClientId ?? "internal-api-client-1",
      oauthClientId,
      policyVersionId: overrides.policyVersionId ?? "policy-v1",
    }),
  }) as AuthenticatedApiContext;
}

const HEX64 = /^[0-9a-f]{64}$/;

// -----------------------------------------------------------------------------
// readIdempotencyKey
// -----------------------------------------------------------------------------

Deno.test("readIdempotencyKey: missing header rejected", () => {
  assertThrows(
    () => readIdempotencyKey(makeRequest({})),
    IdempotencyValidationError,
    "missing_idempotency_key",
  );
});

Deno.test("readIdempotencyKey: blank/whitespace rejected", () => {
  for (const v of ["", "   ", "\t"]) {
    assertThrows(
      () => readIdempotencyKey(makeRequest({ "Idempotency-Key": v })),
      IdempotencyValidationError,
    );
  }
});

Deno.test("readIdempotencyKey: forbidden characters rejected", () => {
  // Some values (control chars, newline) are rejected by the Headers
  // constructor itself, so we use a lightweight mock that bypasses that
  // to prove readIdempotencyKey's own validator rejects them.
  const forbidden = [
    "abc def", // whitespace inside
    "abc,def", // comma
    "abc\u0001def", // control
    "abc\ndef", // newline
    "a".repeat(256), // too long
    "abc\"def", // quote (not in allowed set)
    "abc;def",
  ];
  for (const v of forbidden) {
    const req = {
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "idempotency-key" ? v : null,
      },
    } as unknown as Request;
    assertThrows(
      () => readIdempotencyKey(req),
      IdempotencyValidationError,
      "invalid_idempotency_key",
    );
  }
});

Deno.test("readIdempotencyKey: valid key returned trimmed", () => {
  const key = readIdempotencyKey(
    makeRequest({ "Idempotency-Key": "  abc._~:@/+!=-XYZ123  " }),
  );
  assertEquals(key, "abc._~:@/+!=-XYZ123");
});

// -----------------------------------------------------------------------------
// canonicalizePayload / hashCanonicalPayload
// -----------------------------------------------------------------------------

Deno.test("canonicalize: object key order does not affect result", async () => {
  const a = { b: 2, a: 1 };
  const b = { a: 1, b: 2 };
  assertEquals(canonicalizePayload(a), canonicalizePayload(b));
  assertEquals(await hashCanonicalPayload(a), await hashCanonicalPayload(b));
});

Deno.test("canonicalize: nested keys sorted", () => {
  const v = { z: { y: 1, x: 2 }, a: [3, { c: 1, b: 2 }] };
  assertEquals(
    canonicalizePayload(v),
    '{"a":[3,{"b":2,"c":1}],"z":{"x":2,"y":1}}',
  );
});

Deno.test("canonicalize: array order significant", async () => {
  const h1 = await hashCanonicalPayload([1, 2, 3]);
  const h2 = await hashCanonicalPayload([3, 2, 1]);
  assertNotEquals(h1, h2);
});

Deno.test("canonicalize: different payloads produce different hashes", async () => {
  const h1 = await hashCanonicalPayload({ a: 1 });
  const h2 = await hashCanonicalPayload({ a: 2 });
  assertNotEquals(h1, h2);
});

Deno.test('canonicalize: {"a":1,"b":2} exact string and known hash', async () => {
  const s = canonicalizePayload({ a: 1, b: 2 });
  assertEquals(s, '{"a":1,"b":2}');
  const h = await hashCanonicalPayload({ a: 1, b: 2 });
  assertEquals(
    h,
    "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  );
});

Deno.test("hash: 64 lowercase hex", async () => {
  const h = await hashCanonicalPayload({ x: [1, "s", true, null] });
  assert(HEX64.test(h), `expected 64 lc hex, got ${h}`);
});

Deno.test("canonicalize: rejects unsupported values", () => {
  const cases: unknown[] = [
    undefined,
    { a: undefined },
    [undefined],
    () => 1,
    Symbol("s"),
    BigInt(1),
    NaN,
    Infinity,
    -Infinity,
    new Date(),
    new Map(),
    new Set(),
  ];
  for (const c of cases) {
    assertThrows(
      () => canonicalizePayload(c),
      IdempotencyValidationError,
      "invalid_payload",
    );
  }
  // Non-plain (class instance)
  class Foo {
    x = 1;
  }
  assertThrows(() => canonicalizePayload(new Foo()), IdempotencyValidationError);
  // Cycles
  const cyc: Record<string, unknown> = { a: 1 };
  cyc.self = cyc;
  assertThrows(() => canonicalizePayload(cyc), IdempotencyValidationError);
});

Deno.test("canonicalize: accepts null-prototype plain object", () => {
  const o = Object.create(null) as Record<string, unknown>;
  o.a = 1;
  o.b = 2;
  assertEquals(canonicalizePayload(o), '{"a":1,"b":2}');
});

Deno.test("canonicalize: input not mutated", () => {
  const input = { b: 2, a: 1, nested: { z: 1, y: 2 } };
  const before = JSON.stringify(input);
  canonicalizePayload(input);
  assertEquals(JSON.stringify(input), before);
  assertEquals(Object.keys(input), ["b", "a", "nested"]);
});

Deno.test("canonicalize: shared non-cyclic references allowed", () => {
  const shared = { v: 1 };
  const parent = { a: shared, b: shared };
  assertEquals(canonicalizePayload(parent), '{"a":{"v":1},"b":{"v":1}}');
});

// -----------------------------------------------------------------------------
// buildExecutionContext
// -----------------------------------------------------------------------------

const DETERMINISTIC_UUID = "11111111-2222-3333-4444-555555555555";
const deps = { randomUUID: () => DETERMINISTIC_UUID };

Deno.test("buildExecutionContext: missing X-Request-ID uses injected UUID", async () => {
  const req = makeRequest({ "Idempotency-Key": "k1" });
  const ctx = await buildExecutionContext(req, baseAuthCtx(), { a: 1 }, deps);
  assertEquals(ctx.requestId, DETERMINISTIC_UUID);
  assertEquals(ctx.correlationId, DETERMINISTIC_UUID);
});

Deno.test("buildExecutionContext: correlation defaults to request-id", async () => {
  const req = makeRequest({
    "Idempotency-Key": "k1",
    "X-Request-ID": "req-abc",
  });
  const ctx = await buildExecutionContext(req, baseAuthCtx(), {}, deps);
  assertEquals(ctx.requestId, "req-abc");
  assertEquals(ctx.correlationId, "req-abc");
});

Deno.test("buildExecutionContext: supplied ids preserved", async () => {
  const req = makeRequest({
    "Idempotency-Key": "k1",
    "X-Request-ID": "req-abc",
    "X-Correlation-ID": "corr-xyz",
  });
  const ctx = await buildExecutionContext(req, baseAuthCtx(), {}, deps);
  assertEquals(ctx.requestId, "req-abc");
  assertEquals(ctx.correlationId, "corr-xyz");
});

Deno.test("buildExecutionContext: invalid request/correlation ids rejected", async () => {
  for (const bad of ["", "  ", "has space", "has,comma", "a".repeat(129), "ctrl\u0001"]) {
    await assertRejects(
      () =>
        buildExecutionContext(
          makeRequest({ "Idempotency-Key": "k1", "X-Request-ID": bad }),
          baseAuthCtx(),
          {},
          deps,
        ),
      ExecutionContextError,
      "invalid_request_id",
    );
    await assertRejects(
      () =>
        buildExecutionContext(
          makeRequest({
            "Idempotency-Key": "k1",
            "X-Request-ID": "req-ok",
            "X-Correlation-ID": bad,
          }),
          baseAuthCtx(),
          {},
          deps,
        ),
      ExecutionContextError,
      "invalid_correlation_id",
    );
  }
});

Deno.test("buildExecutionContext: mismatched user identity rejected", async () => {
  await assertRejects(
    () =>
      buildExecutionContext(
        makeRequest({ "Idempotency-Key": "k1" }),
        baseAuthCtx({ tokenUserId: "u1", clientUserId: "u2" }),
        {},
        deps,
      ),
    ExecutionContextError,
    "invalid_authenticated_context",
  );
});

Deno.test("buildExecutionContext: mismatched OAuth client rejected", async () => {
  await assertRejects(
    () =>
      buildExecutionContext(
        makeRequest({ "Idempotency-Key": "k1" }),
        baseAuthCtx({ tokenClientId: "a", oauthClientId: "b" }),
        {},
        deps,
      ),
    ExecutionContextError,
    "invalid_authenticated_context",
  );
});

Deno.test("buildExecutionContext: source classification is server-assigned", async () => {
  const req = makeRequest({ "Idempotency-Key": "k1" });
  const ctx = await buildExecutionContext(req, baseAuthCtx(), { a: 1 }, deps);
  assertEquals(ctx.sourceChannel, "external_api");
  assertEquals(ctx.sourceClientId, "internal-api-client-1");
  assertEquals(ctx.apiClientId, "internal-api-client-1");
  assertEquals(ctx.delegationMode, "delegated_user");
});

Deno.test("buildExecutionContext: forged headers ignored", async () => {
  const req = makeRequest({
    "Idempotency-Key": "k1",
    "X-BTPM-Client-ID": "attacker",
    "X-BTPM-Source-Channel": "btpm_ui",
    "X-BTPM-Source-System": "attacker",
    "X-BTPM-Source-Component": "attacker",
    "X-BTPM-Requested-User-ID": "attacker-user",
    "X-BTPM-Executing-User-ID": "attacker-user",
    "X-BTPM-Delegation-Mode": "direct_user",
  });
  const ctx = await buildExecutionContext(req, baseAuthCtx(), {}, deps);
  assertEquals(ctx.sourceChannel, "external_api");
  assertEquals(ctx.sourceClientId, "internal-api-client-1");
  assertEquals(ctx.requestedUserId, "user-1");
  assertEquals(ctx.executingUserId, "user-1");
  assertEquals(ctx.delegationMode, "delegated_user");
  assertEquals(ctx.oauthClientId, "oauth-client-1");
});

Deno.test("buildExecutionContext: returned context has hash and no raw/canonical payload", async () => {
  const payload = { b: 2, a: 1 };
  const req = makeRequest({ "Idempotency-Key": "k1" });
  const ctx = await buildExecutionContext(req, baseAuthCtx(), payload, deps);
  assert(HEX64.test(ctx.payloadHash));
  const asRecord = ctx as unknown as Record<string, unknown>;
  const forbidden = ["payload", "canonicalPayload", "rawPayload", "body"];
  for (const k of forbidden) {
    assert(!(k in asRecord), `unexpected field ${k}`);
  }
});

Deno.test("buildExecutionContext: returned context is frozen", async () => {
  const ctx = await buildExecutionContext(
    makeRequest({ "Idempotency-Key": "k1" }),
    baseAuthCtx(),
    {},
    deps,
  );
  assert(Object.isFrozen(ctx));
});
