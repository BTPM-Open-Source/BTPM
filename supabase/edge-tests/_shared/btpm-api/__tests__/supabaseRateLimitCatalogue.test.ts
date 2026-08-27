// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/supabaseRateLimitCatalogue.test.ts', import.meta.url).href;
// API-G.5.10D-3B — Focused tests for the default catalogue profile resolver.
//
// These tests use only injected narrow test doubles. They do not touch the
// environment, network, database, or any live Supabase client.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApiHttpError } from "../../../../functions/_shared/btpm-api/http.ts";
import {
  createSupabaseRateLimitProfileResolver,
  type SupabaseRateLimitClient,
} from "../../../../functions/_shared/btpm-api/supabaseRateLimit.ts";

const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const ROUTE_ID = "v1.me";

interface RecordedCall {
  table: string;
  columns: string[];
  filters: Array<{ column: string; value: unknown }>;
  limits: number[];
}

interface QueryChain {
  select(columns: string): QueryChain;
  eq(column: string, value: string | boolean): QueryChain;
  limit(count: number): PromiseLike<unknown>;
}

function createClientDouble(
  result: unknown,
  options?: { throwOnAwait?: boolean },
): { client: SupabaseRateLimitClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const client = {
    from(table: string): unknown {
      const call: RecordedCall = {
        table,
        columns: [],
        filters: [],
        limits: [],
      };
      calls.push(call);
      const chain: QueryChain = {
        select(columns: string): QueryChain {
          call.columns.push(columns);
          return chain;
        },
        eq(column: string, value: string | boolean): QueryChain {
          call.filters.push({ column, value });
          return chain;
        },
        limit(count: number): PromiseLike<unknown> {
          call.limits.push(count);
          if (options?.throwOnAwait === true) {
            return {
              then(): never {
                throw new Error("supabase transport failure");
              },
            } as unknown as PromiseLike<unknown>;
          }
          return Promise.resolve(result);
        },
      };
      return chain;
    },
    rpc(): PromiseLike<unknown> {
      throw new Error("rpc must not be used by the profile resolver");
    },
  };

  return { client: client as unknown as SupabaseRateLimitClient, calls };
}

async function expectInternalError(fn: () => Promise<unknown>): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof ApiHttpError, "expected ApiHttpError");
  assertStrictEquals((caught as ApiHttpError).code, "internal_error");
}

Deno.test("API-G.5.10D-3B: exact catalogue query and successful mapping", async () => {
  const { client, calls } = createClientDouble({
    data: [{ request_limit: 120, window_seconds: 30, extra_field: "ignored" }],
    error: null,
  });

  const resolver = createSupabaseRateLimitProfileResolver(client);
  const profile = await resolver.resolve(API_CLIENT_ID, ROUTE_ID);

  assertEquals(calls.length, 1);
  const call = calls[0];
  assertStrictEquals(call.table, "api_rate_limit_profile_catalogue");
  assertEquals(call.columns, ["request_limit,window_seconds"]);
  assertEquals(call.filters, [
    { column: "lifecycle_status", value: "active" },
    { column: "is_default", value: true },
  ]);
  assertEquals(call.limits, [2]);

  const filterColumns = call.filters.map((f) => f.column);
  assertFalse(filterColumns.includes("api_client_id"));
  assertFalse(filterColumns.includes("route_id"));
  const filterValues = call.filters.map((f) => f.value);
  assertFalse(filterValues.includes(API_CLIENT_ID));
  assertFalse(filterValues.includes(ROUTE_ID));

  assertEquals(profile, { limit: 120, windowSeconds: 30 });
  assert(Object.isFrozen(profile));
});

Deno.test("API-G.5.10D-3B: invalid input fails before database access", async () => {
  const { client, calls } = createClientDouble({
    data: [{ request_limit: 60, window_seconds: 60 }],
    error: null,
  });
  const resolver = createSupabaseRateLimitProfileResolver(client);

  await expectInternalError(() => resolver.resolve("not-a-uuid", ROUTE_ID));
  await expectInternalError(() =>
    resolver.resolve(API_CLIENT_ID, "bad route id!")
  );
  await expectInternalError(() => resolver.resolve(API_CLIENT_ID, ""));

  assertEquals(calls.length, 0);
});

Deno.test("API-G.5.10D-3B: malformed or ambiguous catalogue fails closed", async () => {
  const malformedResults: unknown[] = [
    { data: null, error: { message: "boom", code: "42501" } },
    { data: null, error: null },
    { notAWrapper: true },
    { data: { request_limit: 60, window_seconds: 60 }, error: null },
    { data: [], error: null },
    {
      data: [
        { request_limit: 60, window_seconds: 60 },
        { request_limit: 90, window_seconds: 60 },
      ],
      error: null,
    },
    { data: [null], error: null },
    { data: [{ request_limit: 0, window_seconds: 60 }], error: null },
    { data: [{ request_limit: 60, window_seconds: 86_401 }], error: null },
    { data: [{ request_limit: 1.5, window_seconds: 60 }], error: null },
  ];

  for (const result of malformedResults) {
    const { client } = createClientDouble(result);
    const resolver = createSupabaseRateLimitProfileResolver(client);
    await expectInternalError(() => resolver.resolve(API_CLIENT_ID, ROUTE_ID));
  }

  const thrown = createClientDouble(null, { throwOnAwait: true });
  const throwingResolver = createSupabaseRateLimitProfileResolver(
    thrown.client,
  );
  await expectInternalError(() =>
    throwingResolver.resolve(API_CLIENT_ID, ROUTE_ID)
  );
});

Deno.test("API-G.5.10D-3B: runtime and source separation", async () => {
  const adapterSource = await Deno.readTextFile(
    new URL("../supabaseRateLimit.ts", __BTPM_SRC_BASE__),
  );
  const resolverStart = adapterSource.indexOf(
    "export function createSupabaseRateLimitProfileResolver",
  );
  const storeStart = adapterSource.indexOf(
    "export function createSupabaseRateLimitStore",
  );
  assert(resolverStart > 0);
  assert(storeStart > resolverStart);
  const resolverSource = adapterSource.slice(resolverStart, storeStart);
  const storeSource = adapterSource.slice(storeStart);

  assert(resolverSource.includes("api_rate_limit_profile_catalogue"));
  assertFalse(resolverSource.includes("api_rate_limit_profiles"));
  assertFalse(
    resolverSource.includes("api_organization_client_rate_profile_assignments"),
  );
  assertFalse(
    resolverSource.includes("api_g_5_10_get_organization_client_rate_profile"),
  );
  assertFalse(
    resolverSource.includes("api_g_5_10_set_organization_client_rate_profile"),
  );
  assertFalse(/\b60\b/.test(resolverSource));

  assert(storeSource.includes("consume_api_rate_limit_v1"));

  const indexSource = await Deno.readTextFile(
    new URL("../../../btpm-api-v1/index.ts", __BTPM_SRC_BASE__),
  );
  assert(
    indexSource.includes(
      "profileResolver.resolve(context.client.apiClientId, route.id)",
    ),
  );

  const rateLimitSource = await Deno.readTextFile(
    new URL("../rateLimit.ts", __BTPM_SRC_BASE__),
  );
  assert(
    rateLimitSource.includes("export async function enforceApiRateLimit"),
  );
  assertFalse(rateLimitSource.includes("api_rate_limit_profile_catalogue"));
});
