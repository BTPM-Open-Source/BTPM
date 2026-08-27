// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/supabaseDelegatedProjectDetail.test.ts', import.meta.url).href;
// API-H.4D — Focused tests for the caller-scoped `/v1/projects/:projectid` reader.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createDelegatedApiV1ProjectDetailReader } from "../../../../functions/_shared/btpm-api/supabaseDelegatedProjectDetail.ts";
import { ApiHttpError } from "../../../../functions/_shared/btpm-api/http.ts";
import { ApiAuthenticationError } from "../../../../functions/_shared/btpm-api/apiErrors.ts";
import type { AuthenticatedApiContext } from "../../../../functions/_shared/btpm-api/authenticateApiRequest.ts";

const URL_VALUE = "https://example.supabase.co";
const ANON_KEY = "anon-key-value";
const CLIENT_ID = "btpm-test-client";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const ORG_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WS_ID = "cccccccc-dddd-4eee-8fff-111111111111";
const PROJECT_ID = "dddddddd-eeee-4fff-8aaa-222222222222";
const TOKEN = "header.payload.signature";

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("Authorization", authorization);
  return new Request(
    `https://api.example.com/v1/projects/${PROJECT_ID}`,
    { headers },
  );
}

function makeContext(): AuthenticatedApiContext {
  return {
    token: {
      userId: USER_ID,
      clientId: "unused-token-client-id",
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

function makeProject() {
  return {
    projectId: PROJECT_ID,
    organizationId: ORG_ID,
    workspaceId: WS_ID,
    programId: null,
    portfolioItemId: null,
    name: "Migration",
    description: null,
    status: "active",
    priority: "high",
    projectStage: null,
    deliveryModel: null,
    startDate: "2026-01-05",
    targetEndDate: "2026-02-28",
    actualStartDate: null,
    actualEndDate: null,
    agileEnabled: false,
    updatedAt: "2026-01-06T07:00:00.000Z",
    charter: null,
    goals: null,
    scopeIn: null,
    scopeOut: null,
    businessCase: null,
    successCriteria: null,
    completionCriteria: null,
    budgetNarrative: null,
    assumptions: null,
    constraints: null,
  };
}

function makeOkPayload() {
  return { data: makeProject(), error: null };
}

Deno.test("valid factory creation returns a reader function", () => {
  const read = createDelegatedApiV1ProjectDetailReader(
    URL_VALUE,
    ANON_KEY,
    () => ({ rpc: () => Promise.resolve(makeOkPayload()) }),
  );
  assertEquals(typeof read, "function");
});

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

  const read = createDelegatedApiV1ProjectDetailReader(
    URL_VALUE,
    ANON_KEY,
    factory,
  );

  const first = await read(
    makeRequest(`Bearer ${TOKEN}`),
    makeContext(),
    PROJECT_ID,
  );
  const second = await read(
    makeRequest(`Bearer ${TOKEN}`),
    makeContext(),
    PROJECT_ID,
  );

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
  assertEquals(rpcCalls[0].fn, "api_v1_get_project");
  assertEquals(rpcCalls[0].args, {
    _expected_oauth_client_id: CLIENT_ID,
    _project_id: PROJECT_ID,
  });

  assertEquals(first, makeProject());
  assert(Object.isFrozen(first));
  assert(first !== second);
});

Deno.test("factory-creation validation: url, anon key, and client factory", () => {
  for (const value of [null, undefined, "", 5, {}] as unknown[]) {
    let err: unknown;
    try {
      createDelegatedApiV1ProjectDetailReader(
        value as string,
        ANON_KEY,
        () => ({ rpc: () => Promise.resolve(makeOkPayload()) }),
      );
    } catch (caught) {
      err = caught;
    }
    assert(err instanceof ApiHttpError);
    assertEquals((err as ApiHttpError).code, "internal_error");

    let keyErr: unknown;
    try {
      createDelegatedApiV1ProjectDetailReader(
        URL_VALUE,
        value as string,
        () => ({ rpc: () => Promise.resolve(makeOkPayload()) }),
      );
    } catch (caught) {
      keyErr = caught;
    }
    assert(keyErr instanceof ApiHttpError);
    assertEquals((keyErr as ApiHttpError).code, "internal_error");
  }

  for (const bad of [null, undefined, "factory", 5, {}]) {
    let err: unknown;
    try {
      createDelegatedApiV1ProjectDetailReader(URL_VALUE, ANON_KEY, bad as never);
    } catch (caught) {
      err = caught;
    }
    assert(err instanceof ApiHttpError);
    assertEquals((err as ApiHttpError).code, "internal_error");
  }
});

Deno.test("non-Request input and invalid context fail before client construction", async () => {
  let invoked = 0;
  const read = createDelegatedApiV1ProjectDetailReader(
    URL_VALUE,
    ANON_KEY,
    () => {
      invoked += 1;
      return { rpc: () => Promise.resolve(makeOkPayload()) };
    },
  );

  for (const bad of [null, undefined, {}, "request", 5]) {
    const err = await assertRejects(
      () => read(bad as never, makeContext(), PROJECT_ID),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }

  const badContexts: unknown[] = [
    null,
    undefined,
    [],
    "context",
    {},
    { client: null },
    { client: [] },
    { client: {} },
    { client: { oauthClientId: "" } },
    { client: { oauthClientId: 5 } },
    { token: { clientId: CLIENT_ID } },
  ];
  for (const context of badContexts) {
    const err = await assertRejects(
      () => read(makeRequest(`Bearer ${TOKEN}`), context as never, PROJECT_ID),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }

  assertEquals(invoked, 0);
});

Deno.test("bad bearer credentials preserve ApiAuthenticationError before client construction", async () => {
  let invoked = 0;
  const read = createDelegatedApiV1ProjectDetailReader(
    URL_VALUE,
    ANON_KEY,
    () => {
      invoked += 1;
      return { rpc: () => Promise.resolve(makeOkPayload()) };
    },
  );

  for (
    const authorization of [undefined, "", "Basic abc", "Bearer", "Bearer   "]
  ) {
    await assertRejects(
      () => read(makeRequest(authorization), makeContext(), PROJECT_ID),
      ApiAuthenticationError,
    );
  }
  assertEquals(invoked, 0);
});

Deno.test("throwing or malformed client factory maps to internal_error", async () => {
  const throwing = createDelegatedApiV1ProjectDetailReader(
    URL_VALUE,
    ANON_KEY,
    () => {
      throw new Error("boom");
    },
  );
  const thrownErr = await assertRejects(
    () => throwing(makeRequest(`Bearer ${TOKEN}`), makeContext(), PROJECT_ID),
    ApiHttpError,
  );
  assertEquals(thrownErr.code, "internal_error");
  assert(!thrownErr.publicMessage.includes("boom"));

  for (const created of [null, undefined, [], "client", 5, { notRpc: true }]) {
    const malformed = createDelegatedApiV1ProjectDetailReader(
      URL_VALUE,
      ANON_KEY,
      () => created,
    );
    const err = await assertRejects(
      () => malformed(makeRequest(`Bearer ${TOKEN}`), makeContext(), PROJECT_ID),
      ApiHttpError,
    );
    assertEquals(err.code, "internal_error");
  }
});

Deno.test("project-detail adapter errors propagate unchanged", async () => {
  const cases: { error: unknown; code: string; status: number }[] = [
    { error: { code: "42501", message: "denied" }, code: "not_authorized", status: 403 },
    { error: { code: "22023", message: "bad param" }, code: "invalid_request", status: 400 },
    { error: { code: "23505", message: "secret detail" }, code: "internal_error", status: 500 },
  ];
  for (const testCase of cases) {
    const read = createDelegatedApiV1ProjectDetailReader(
      URL_VALUE,
      ANON_KEY,
      () => ({ rpc: () => Promise.resolve({ data: null, error: testCase.error }) }),
    );
    const err = await assertRejects(
      () => read(makeRequest(`Bearer ${TOKEN}`), makeContext(), PROJECT_ID),
      ApiHttpError,
    );
    assertEquals(err.code, testCase.code);
    assertEquals(err.status, testCase.status);
    assert(!err.publicMessage.includes("secret detail"));
  }

  const rejecting = createDelegatedApiV1ProjectDetailReader(
    URL_VALUE,
    ANON_KEY,
    () => ({ rpc: () => Promise.reject(new Error("boom")) }),
  );
  const rejectErr = await assertRejects(
    () => rejecting(makeRequest(`Bearer ${TOKEN}`), makeContext(), PROJECT_ID),
    ApiHttpError,
  );
  assertEquals(rejectErr.code, "internal_error");

  // Adapter-level Project-ID validation is not duplicated here.
  let rpcInvocations = 0;
  const badIdRead = createDelegatedApiV1ProjectDetailReader(
    URL_VALUE,
    ANON_KEY,
    () => ({
      rpc: () => {
        rpcInvocations += 1;
        return Promise.resolve(makeOkPayload());
      },
    }),
  );
  for (
    const badId of [
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
      "",
    ]
  ) {
    const badIdErr = await assertRejects(
      () => badIdRead(makeRequest(`Bearer ${TOKEN}`), makeContext(), badId),
      ApiHttpError,
    );
    assertEquals(badIdErr.code, "invalid_request");
  }
  assertEquals(rpcInvocations, 0);
});

Deno.test("module contains no environment, service-role, direct SDK, fetch, logging, caching, timer or generic RPC behavior", async () => {
  const source = await Deno.readTextFile(
    new URL("../supabaseDelegatedProjectDetail.ts", __BTPM_SRC_BASE__),
  );
  for (
    const forbidden of [
      "Deno.env",
      "SUPABASE_",
      "SERVICE_ROLE",
      "service_role",
      "@supabase/supabase-js",
      "esm.sh",
      "fetch(",
      "console.",
      "setTimeout",
      "setInterval",
      "new Map",
      "new WeakMap",
      "context.token.clientId",
      ".rpc(",
    ]
  ) {
    assert(!source.includes(forbidden), `module must not contain ${forbidden}`);
  }
  const rpcNames = source.match(/"api_v1_[a-z_]+"/g) ?? [];
  assertEquals(rpcNames, []);
  assertEquals(source.split("readApiV1ProjectDetail(").length - 1, 1);
  assert(source.includes("extractBearerToken"));
});
