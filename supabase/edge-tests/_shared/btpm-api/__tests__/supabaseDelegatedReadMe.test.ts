// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/supabaseDelegatedReadMe.test.ts', import.meta.url).href;
// API-G.2C — Focused tests for the caller-scoped `/v1/me` read client.

import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createDelegatedApiV1MeReader } from "../../../../functions/_shared/btpm-api/supabaseDelegatedReadMe.ts";
import { ApiHttpError } from "../../../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../../../functions/_shared/btpm-api/apiErrors.ts";
import type { AuthenticatedApiContext } from "../../../../functions/_shared/btpm-api/authenticateApiRequest.ts";

const URL_VALUE = "https://example.supabase.co";
const ANON_KEY = "anon-key-value";
const CLIENT_ID = "btpm-test-client";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "header.payload.signature";

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("Authorization", authorization);
  return new Request("https://api.example.com/v1/me", { headers });
}

function makeContext(clientId: unknown = CLIENT_ID): AuthenticatedApiContext {
  return {
    token: {
      userId: USER_ID,
      clientId: CLIENT_ID,
      issuer: "iss",
      audiences: ["aud"],
      expiresAt: 1,
    },
    client: { oauthClientId: clientId },
  } as unknown as AuthenticatedApiContext;
}

interface FactoryCall {
  url: string;
  key: string;
  options: unknown;
}

function makeFactory(
  rpcImpl: (fn: string, args: unknown) => Promise<unknown>,
) {
  const calls: FactoryCall[] = [];
  const clients: unknown[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const factory = (url: string, key: string, options: unknown) => {
    calls.push({ url, key, options });
    const client = {
      rpc(fn: string, args: unknown) {
        rpcCalls.push({ fn, args });
        return rpcImpl(fn, args);
      },
    };
    clients.push(client);
    return client;
  };
  return { factory, calls, clients, rpcCalls };
}

const ME_IDENTITY = {
  userId: USER_ID,
  displayName: "Example User",
  email: "vit@example.com",
  isActive: true,
  platformSuperAdmin: false,
  context: null,
};

const NO_CONTEXT = Object.freeze({ contextType: null, contextId: null }) as never;

const okRpc = () => Promise.resolve({ data: ME_IDENTITY, error: null });

Deno.test("passes exact url, key, auth options and bearer header", async () => {
  const { factory, calls } = makeFactory(okRpc);
  const read = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, factory);
  await read(makeRequest(`Bearer ${TOKEN}`), makeContext(), NO_CONTEXT);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, URL_VALUE);
  assertEquals(calls[0].key, ANON_KEY);
  assertEquals(calls[0].options, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
});

Deno.test("passes exact authenticated oauth client id to api_v1_get_me_context", async () => {
  const { factory, rpcCalls } = makeFactory(okRpc);
  const read = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, factory);
  await read(makeRequest(`Bearer ${TOKEN}`), makeContext(), NO_CONTEXT);

  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].fn, "api_v1_get_me_context");
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _context_type: null,
    _context_id: null,
  });
});

Deno.test("returns exact frozen payload, distinct per call, fresh client per call", async () => {
  const { factory, calls, clients } = makeFactory(okRpc);
  const read = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, factory);
  const first = await read(makeRequest(`Bearer ${TOKEN}`), makeContext(), NO_CONTEXT);
  const second = await read(makeRequest(`Bearer ${TOKEN}`), makeContext(), NO_CONTEXT);

  assertEquals(first, ME_IDENTITY as unknown as typeof first);
  assert(Object.isFrozen(first));
  assert(first !== second);
  assertEquals(calls.length, 2);
  assert(clients[0] !== clients[1]);
});

Deno.test("missing or malformed bearer fails before client construction", async () => {
  const { factory, calls } = makeFactory(okRpc);
  const read = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, factory);

  await assertRejects(
    () => read(makeRequest(), makeContext(), NO_CONTEXT),
    ApiAuthenticationError,
  );
  await assertRejects(
    () => read(makeRequest("Basic abc"), makeContext(), NO_CONTEXT),
    ApiAuthenticationError,
  );
  assertEquals(calls.length, 0);
});

Deno.test("invalid construction inputs fail closed without invoking factory", () => {
  let invoked = 0;
  const factory = () => {
    invoked += 1;
    return { rpc: okRpc };
  };
  assertThrows(() => createDelegatedApiV1MeReader("", ANON_KEY, factory), ApiHttpError);
  assertThrows(() => createDelegatedApiV1MeReader(URL_VALUE, "", factory), ApiHttpError);
  assertThrows(
    () =>
      createDelegatedApiV1MeReader(
        URL_VALUE,
        ANON_KEY,
        undefined as unknown as typeof factory,
      ),
    ApiHttpError,
  );
  assertEquals(invoked, 0);
});

Deno.test("invalid request or context fails closed", async () => {
  const { factory, calls } = makeFactory(okRpc);
  const read = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, factory);

  await assertRejects(
    () => read({} as unknown as Request, makeContext(), NO_CONTEXT),
    ApiHttpError,
  );
  await assertRejects(
    () =>
      read(
        makeRequest(`Bearer ${TOKEN}`),
        null as unknown as AuthenticatedApiContext,
        NO_CONTEXT,
      ),
    ApiHttpError,
  );
  await assertRejects(
    () => read(makeRequest(`Bearer ${TOKEN}`), makeContext(""), NO_CONTEXT),
    ApiHttpError,
  );
  await assertRejects(
    () => read(makeRequest(`Bearer ${TOKEN}`), makeContext(42), NO_CONTEXT),
    ApiHttpError,
  );
  assertEquals(calls.length, 0);
});

Deno.test("throwing factory and malformed client fail closed", async () => {
  const throwing = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, () => {
    throw new Error("boom");
  });
  const err = await assertRejects(
    () => throwing(makeRequest(`Bearer ${TOKEN}`), makeContext(), NO_CONTEXT),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");

  const malformed = createDelegatedApiV1MeReader(
    URL_VALUE,
    ANON_KEY,
    () => ({ notRpc: true }),
  );
  await assertRejects(
    () => malformed(makeRequest(`Bearer ${TOKEN}`), makeContext(), NO_CONTEXT),
    ApiHttpError,
  );
});

Deno.test("adapter authorization and internal errors are preserved", async () => {
  const denied = makeFactory(() =>
    Promise.resolve({ data: null, error: { code: "42501" } })
  );
  const readDenied = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, denied.factory);
  const deniedErr = await assertRejects(
    () => readDenied(makeRequest(`Bearer ${TOKEN}`), makeContext(), NO_CONTEXT),
    ApiHttpError,
  );
  assertStrictEquals(deniedErr.code, "not_authorized");

  const broken = makeFactory(() => Promise.resolve({ data: {}, error: null }));
  const readBroken = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, broken.factory);
  const brokenErr = await assertRejects(
    () => readBroken(makeRequest(`Bearer ${TOKEN}`), makeContext(), NO_CONTEXT),
    ApiHttpError,
  );
  assertStrictEquals(brokenErr.code, "internal_error");
});

Deno.test("does not mutate request, context, or result", async () => {
  const { factory } = makeFactory(okRpc);
  const read = createDelegatedApiV1MeReader(URL_VALUE, ANON_KEY, factory);
  const request = makeRequest(`Bearer ${TOKEN}`);
  const context = makeContext();
  const snapshot = JSON.stringify(context);

  const payload = await read(request, context, NO_CONTEXT);

  assertEquals(JSON.stringify(context), snapshot);
  assertEquals(request.headers.get("Authorization"), `Bearer ${TOKEN}`);
  assertThrows(() => {
    "use strict";
    (payload as unknown as Record<string, unknown>).userId = "x";
  });
});

Deno.test("module source contains no forbidden surface", async () => {
  const source = await Deno.readTextFile(
    new URL("../supabaseDelegatedReadMe.ts", __BTPM_SRC_BASE__),
  );
  for (
    const forbidden of [
      "@supabase/supabase-js",
      "Deno.env",
      "service_role",
      "SERVICE_ROLE",
      "fetch(",
      "console.",
      "Deno.serve",
      "serve(",
    ]
  ) {
    assert(!source.includes(forbidden), `forbidden: ${forbidden}`);
  }
  // Exactly one delegated adapter call, no generic/dynamic RPC surface.
  assertEquals(source.split("readApiV1Me(").length - 1, 1);
  assert(!source.includes(".rpc("));
});
