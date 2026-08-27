// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/rateLimit.test.ts', import.meta.url).href;
// Focused Deno tests for API-G.1F atomic rate-limit contract.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError, toSafeHttpErrorResponse } from "../../../../functions/_shared/btpm-api/http.ts";
import {
  type ApiRateLimitDependencies,
  type ApiRateLimitProfile,
  type ApiRateLimitStore,
  type ApiRateLimitStoreInput,
  type ApiRateLimitStoreResult,
  type ApiRateLimitSubject,
  enforceApiRateLimit,
} from "../../../../functions/_shared/btpm-api/rateLimit.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-9222-222222222222";
const ROUTE_ID = "route.projects.list";

function subj(overrides: Partial<ApiRateLimitSubject> = {}): ApiRateLimitSubject {
  return { apiClientId: CLIENT_ID, userId: USER_ID, routeId: ROUTE_ID, ...overrides };
}
function prof(overrides: Partial<ApiRateLimitProfile> = {}): ApiRateLimitProfile {
  return { limit: 10, windowSeconds: 60, ...overrides };
}

interface FakeCall {
  input: ApiRateLimitStoreInput;
}

function makeStore(
  impl: (input: ApiRateLimitStoreInput) => Promise<ApiRateLimitStoreResult> | ApiRateLimitStoreResult,
) {
  const calls: FakeCall[] = [];
  const store: ApiRateLimitStore = {
    consume(input) {
      calls.push({ input });
      return Promise.resolve(impl(input));
    },
  };
  return { store, calls };
}

function makeClock(values: number[]) {
  const calls: number[] = [];
  return {
    now(): number {
      const v = values[calls.length] ?? values[values.length - 1];
      calls.push(v);
      return v;
    },
    calls,
  };
}

function deps(
  store: ApiRateLimitStore,
  now: () => number,
): ApiRateLimitDependencies {
  return { store, now };
}

Deno.test("allowed decision returns only remaining and resetAtEpochMs, frozen", async () => {
  const { store } = makeStore(() => ({
    allowed: true,
    remaining: 9,
    resetAtEpochMs: 1_000_060_000,
  }));
  const clock = makeClock([1_000_000_000]);
  const result = await enforceApiRateLimit(subj(), prof(), deps(store, clock.now));
  assertEquals(result, { remaining: 9, resetAtEpochMs: 1_000_060_000 });
  assertEquals(Object.keys(result).sort(), ["remaining", "resetAtEpochMs"]);
  assert(Object.isFrozen(result));
});

Deno.test("store is called exactly once and now() exactly once", async () => {
  const { store, calls } = makeStore(() => ({
    allowed: true, remaining: 5, resetAtEpochMs: 2_000_000_000,
  }));
  const clock = makeClock([1_500_000_000]);
  await enforceApiRateLimit(subj(), prof(), deps(store, clock.now));
  assertEquals(calls.length, 1);
  assertEquals(clock.calls.length, 1);
});

Deno.test("store input is a newly constructed object with validated values", async () => {
  const s = subj();
  const p = prof({ limit: 7, windowSeconds: 30 });
  let captured: ApiRateLimitStoreInput | null = null;
  const store: ApiRateLimitStore = {
    consume(input) {
      captured = input;
      return Promise.resolve({ allowed: true, remaining: 6, resetAtEpochMs: 1_000_030_000 });
    },
  };
  await enforceApiRateLimit(s, p, deps(store, () => 1_000_000_000));
  assert(captured !== null);
  assertEquals(captured, {
    apiClientId: CLIENT_ID,
    userId: USER_ID,
    routeId: ROUTE_ID,
    limit: 7,
    windowSeconds: 30,
    nowEpochMs: 1_000_000_000,
  });
  // Not the same reference as caller inputs.
  assert(captured !== (s as unknown));
  assert(captured !== (p as unknown));
});

Deno.test("original subject and profile are not mutated", async () => {
  const s = subj();
  const p = prof();
  const sSnap = { ...s };
  const pSnap = { ...p };
  const { store } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1_000_060_000 }));
  await enforceApiRateLimit(s, p, deps(store, () => 1_000_000_000));
  assertEquals(s, sSnap);
  assertEquals(p, pSnap);
});

Deno.test("invalid client UUID fails before store call", async () => {
  const { store, calls } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1 }));
  const err = await assertRejects(
    () => enforceApiRateLimit(subj({ apiClientId: "not-a-uuid" }), prof(), deps(store, () => 1)),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertEquals(calls.length, 0);
});

Deno.test("invalid user UUID fails before store call", async () => {
  const { store, calls } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1 }));
  await assertRejects(
    () => enforceApiRateLimit(subj({ userId: "xxx" }), prof(), deps(store, () => 1)),
    ApiHttpError,
  );
  assertEquals(calls.length, 0);
});

Deno.test("invalid route ID fails before store call", async () => {
  const { store, calls } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1 }));
  for (const bad of ["", " space ", "with/slash", "a".repeat(129), "bad$char"]) {
    await assertRejects(
      () => enforceApiRateLimit(subj({ routeId: bad }), prof(), deps(store, () => 1)),
      ApiHttpError,
    );
  }
  assertEquals(calls.length, 0);
});

Deno.test("invalid limit values fail before store call", async () => {
  const { store, calls } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1 }));
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10" as unknown as number]) {
    await assertRejects(
      () => enforceApiRateLimit(subj(), prof({ limit: bad as number }), deps(store, () => 1)),
      ApiHttpError,
    );
  }
  assertEquals(calls.length, 0);
});

Deno.test("invalid windowSeconds fails before store call", async () => {
  const { store, calls } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1 }));
  for (const bad of [0, -30, 1.2, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assertRejects(
      () => enforceApiRateLimit(subj(), prof({ windowSeconds: bad }), deps(store, () => 1)),
      ApiHttpError,
    );
  }
  assertEquals(calls.length, 0);
});

Deno.test("invalid dependencies fail safely", async () => {
  const { store } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1 }));
  await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), null as unknown as ApiRateLimitDependencies),
    ApiHttpError,
  );
  await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), { store, now: "nope" as unknown as () => number }),
    ApiHttpError,
  );
  await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), { store: {} as ApiRateLimitStore, now: () => 1 }),
    ApiHttpError,
  );
  await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), { store: null as unknown as ApiRateLimitStore, now: () => 1 }),
    ApiHttpError,
  );
});

Deno.test("invalid clock output fails before store call", async () => {
  const { store, calls } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1 }));
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "x" as unknown as number]) {
    await assertRejects(
      () => enforceApiRateLimit(subj(), prof(), deps(store, () => bad as number)),
      ApiHttpError,
    );
  }
  assertEquals(calls.length, 0);
});

Deno.test("clock throw is wrapped as internal_error, store not called", async () => {
  const { store, calls } = makeStore(() => ({ allowed: true, remaining: 1, resetAtEpochMs: 1 }));
  const err = await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), deps(store, () => { throw new Error("clock boom"); })),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertEquals(calls.length, 0);
});

Deno.test("denied decision throws rate_limit_exceeded with status 429 and safe message", async () => {
  const { store } = makeStore(() => ({ allowed: false, remaining: 0, resetAtEpochMs: 1_000_060_000 }));
  const err = await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), deps(store, () => 1_000_000_000)),
    ApiHttpError,
  );
  assertEquals(err.code, "rate_limit_exceeded");
  assertEquals(err.status, 429);
  assertEquals(err.publicMessage, "Rate limit exceeded.");
});

Deno.test("existing ApiHttpError store failure is preserved as the exact same instance", async () => {
  const original = new ApiHttpError("request_timeout");
  const store: ApiRateLimitStore = {
    consume: () => Promise.reject(original),
  };
  const err = await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), deps(store, () => 1)),
    ApiHttpError,
  );
  assertStrictEquals(err, original);
});

Deno.test("ordinary store failures map to internal_error", async () => {
  const store: ApiRateLimitStore = {
    consume: () => Promise.reject(new Error("db down: secret=abc")),
  };
  const err = await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), deps(store, () => 1)),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("synchronous store throw is wrapped as internal_error", async () => {
  const store: ApiRateLimitStore = {
    consume: (() => { throw new Error("sync boom"); }) as unknown as ApiRateLimitStore["consume"],
  };
  const err = await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), deps(store, () => 1)),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("malformed store result shapes map to internal_error", async () => {
  const bads: unknown[] = [
    null,
    "string",
    42,
    { allowed: "true", remaining: 1, resetAtEpochMs: 1_000_000_000 },
    { allowed: true, remaining: -1, resetAtEpochMs: 1_000_000_000 },
    { allowed: true, remaining: 1.5, resetAtEpochMs: 1_000_000_000 },
    { allowed: true, remaining: 1, resetAtEpochMs: 1.5 },
    { allowed: true, remaining: 1, resetAtEpochMs: Number.NaN },
    { allowed: true, remaining: 1 },
    { remaining: 1, resetAtEpochMs: 1_000_000_000 },
  ];
  for (const bad of bads) {
    const store: ApiRateLimitStore = { consume: () => Promise.resolve(bad as ApiRateLimitStoreResult) };
    const err = await assertRejects(
      () => enforceApiRateLimit(subj(), prof(), deps(store, () => 1_000_000_000)),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("remaining above configured limit is rejected", async () => {
  const store: ApiRateLimitStore = {
    consume: () => Promise.resolve({ allowed: true, remaining: 11, resetAtEpochMs: 1_000_060_000 }),
  };
  const err = await assertRejects(
    () => enforceApiRateLimit(subj(), prof({ limit: 10 }), deps(store, () => 1_000_000_000)),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("reset time earlier than captured now is rejected", async () => {
  const store: ApiRateLimitStore = {
    consume: () => Promise.resolve({ allowed: true, remaining: 1, resetAtEpochMs: 999_999_999 }),
  };
  const err = await assertRejects(
    () => enforceApiRateLimit(subj(), prof(), deps(store, () => 1_000_000_000)),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
});

Deno.test("extra store-result properties are ignored", async () => {
  const store: ApiRateLimitStore = {
    consume: () => Promise.resolve({
      allowed: true,
      remaining: 3,
      resetAtEpochMs: 1_000_060_000,
      // deno-lint-ignore no-explicit-any
      leaked: "SECRET",
      counters: { hidden: 1 },
    } as unknown as ApiRateLimitStoreResult),
  };
  const result = await enforceApiRateLimit(subj(), prof(), deps(store, () => 1_000_000_000));
  assertEquals(result, { remaining: 3, resetAtEpochMs: 1_000_060_000 });
  assertEquals(Object.keys(result).sort(), ["remaining", "resetAtEpochMs"]);
});

Deno.test("safe serialization of denial exposes no sensitive fields", async () => {
  const store: ApiRateLimitStore = {
    consume: () => Promise.resolve({ allowed: false, remaining: 0, resetAtEpochMs: 1_000_060_000 }),
  };
  let caught: unknown = null;
  try {
    await enforceApiRateLimit(subj(), prof(), deps(store, () => 1_000_000_000));
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof ApiHttpError);
  const response = toSafeHttpErrorResponse(caught, "req-xyz");
  assertEquals(response.status, 429);
  const body = await response.json();
  assertEquals(body, {
    error: { code: "rate_limit_exceeded", message: "Rate limit exceeded." },
    requestId: "req-xyz",
  });
  const text = JSON.stringify(body);
  assert(!text.includes(CLIENT_ID));
  assert(!text.includes(USER_ID));
  assert(!text.includes(ROUTE_ID));
  assert(!text.includes("limit\":"));
  assert(!text.includes("remaining"));
  assert(!text.includes("resetAt"));
  assert(!text.includes("1000060000"));
});

Deno.test("safe serialization of store failure exposes no underlying message", async () => {
  const store: ApiRateLimitStore = {
    consume: () => Promise.reject(new Error("db-secret=abc123 user=uuu")),
  };
  let caught: unknown = null;
  try {
    await enforceApiRateLimit(subj(), prof(), deps(store, () => 1_000_000_000));
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof ApiHttpError);
  const response = toSafeHttpErrorResponse(caught, "req-1");
  const body = await response.json();
  const text = JSON.stringify(body);
  assert(!text.includes("db-secret"));
  assert(!text.includes("abc123"));
  assert(!text.includes(CLIENT_ID));
  assert(!text.includes(USER_ID));
  assert(!text.includes(ROUTE_ID));
});

Deno.test("rateLimit.ts contains no in-memory map, env, Supabase, timers, retries, or logging", async () => {
  const src = await Deno.readTextFile(
    new URL("../rateLimit.ts", __BTPM_SRC_BASE__),
  );
  const forbidden = [
    "new Map",
    "new WeakMap",
    "Deno.env",
    "process.env",
    "createClient",
    "SUPABASE_",
    "service_role",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "console.log",
    "console.warn",
    "console.error",
    "fetch(",
    "retry",
  ];
  for (const needle of forbidden) {
    assert(
      !src.includes(needle),
      `rateLimit.ts must not contain '${needle}'`,
    );
  }
});
