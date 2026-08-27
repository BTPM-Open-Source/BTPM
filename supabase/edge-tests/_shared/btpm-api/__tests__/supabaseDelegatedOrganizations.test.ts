// API-G.2F — Focused tests for the caller-scoped `/v1/organizations` reader.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createDelegatedApiV1OrganizationsReader } from "../../../../functions/_shared/btpm-api/supabaseDelegatedOrganizations.ts";
import { ApiHttpError } from "../../../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../../../functions/_shared/btpm-api/apiErrors.ts";
import type { AuthenticatedApiContext } from "../../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import type { ApiV1OrganizationsQuery } from "../../../../functions/_shared/btpm-api/supabaseOrganizations.ts";

const URL_VALUE = "https://example.supabase.co";
const ANON_KEY = "anon-key-value";
const CLIENT_ID = "btpm-test-client";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const ORG_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "header.payload.signature";

const QUERY: ApiV1OrganizationsQuery = Object.freeze({
  limit: 25,
  offset: 0,
  search: null,
}) as ApiV1OrganizationsQuery;

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("Authorization", authorization);
  return new Request("https://api.example.com/v1/organizations", { headers });
}

function makeContext(): AuthenticatedApiContext {
  return {
    token: {
      userId: USER_ID,
      clientId: CLIENT_ID,
      issuer: "iss",
      audiences: ["aud"],
      expiresAt: 1,
    },
    client: { oauthClientId: CLIENT_ID },
  } as unknown as AuthenticatedApiContext;
}

interface FactoryCall {
  url: string;
  key: string;
  options: unknown;
}

function makeOkPayload() {
  return {
    data: {
      items: [
        { organizationId: ORG_ID, name: "Acme", role: "org_admin" },
      ],
      pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
    },
    error: null,
  };
}

Deno.test("happy path: exact factory args, bearer, oauth client id, rpc args, frozen payload, fresh client per call", async () => {
  const calls: FactoryCall[] = [];
  const clients: unknown[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const factory = (url: string, key: string, options: unknown) => {
    calls.push({ url, key, options });
    const client = {
      rpc(fn: string, args: unknown) {
        rpcCalls.push({ fn, args });
        return Promise.resolve(makeOkPayload());
      },
    };
    clients.push(client);
    return client;
  };

  const read = createDelegatedApiV1OrganizationsReader(URL_VALUE, ANON_KEY, factory);

  const first = await read(makeRequest(`Bearer ${TOKEN}`), makeContext(), QUERY);
  const second = await read(makeRequest(`Bearer ${TOKEN}`), makeContext(), QUERY);

  assertEquals(calls.length, 2);
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

  assert(clients[0] !== clients[1]);

  assertEquals(rpcCalls.length, 2);
  assertEquals(rpcCalls[0].fn, "api_v1_list_organizations");
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _limit: 25,
    _offset: 0,
    _search: null,
  });

  assertEquals(first, {
    items: [{ organizationId: ORG_ID, name: "Acme", role: "org_admin" }],
    pagination: { limit: 25, offset: 0, returned: 1, total: 1 },
  });
  assert(Object.isFrozen(first));
  assert(first !== second);
});

Deno.test("failure boundary: bad bearer fails before client construction; throwing/malformed factory maps to internal_error", async () => {
  let invoked = 0;
  const okFactory = () => {
    invoked += 1;
    return { rpc: () => Promise.resolve(makeOkPayload()) };
  };
  const readOk = createDelegatedApiV1OrganizationsReader(URL_VALUE, ANON_KEY, okFactory);

  await assertRejects(
    () => readOk(makeRequest(), makeContext(), QUERY),
    ApiAuthenticationError,
  );
  await assertRejects(
    () => readOk(makeRequest("Basic abc"), makeContext(), QUERY),
    ApiAuthenticationError,
  );
  assertEquals(invoked, 0);

  const throwing = createDelegatedApiV1OrganizationsReader(URL_VALUE, ANON_KEY, () => {
    throw new Error("boom");
  });
  const thrownErr = await assertRejects(
    () => throwing(makeRequest(`Bearer ${TOKEN}`), makeContext(), QUERY),
    ApiHttpError,
  );
  assertEquals(thrownErr.code, "internal_error");

  const malformed = createDelegatedApiV1OrganizationsReader(
    URL_VALUE,
    ANON_KEY,
    () => ({ notRpc: true }),
  );
  const malformedErr = await assertRejects(
    () => malformed(makeRequest(`Bearer ${TOKEN}`), makeContext(), QUERY),
    ApiHttpError,
  );
  assertEquals(malformedErr.code, "internal_error");
});
