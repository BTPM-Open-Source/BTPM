// UX-GAP.2C — MCP Policy Reauthentication Challenge.
//
// Proves ONLY:
//   A. bounded reauthentication classification in authorizeMcpConnectedApp;
//   B. the pure invalid_token challenge builder;
//   C-E. the three recoverable policy-acknowledgement states return 401 + the
//        reauthentication challenge and never reach the MCP handler;
//   F-H. every other Connected App governance failure still returns the exact
//        existing 403 with NO WWW-Authenticate;
//   I. the pre-existing authentication-401 path is unchanged;
//   J. a fully acknowledged request still reaches the MCP handler;
//   K. neither public response leaks any internal reason or identifier.

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  BTPM_MCP_REQUEST_ID_HEADER,
  createBtpmMcpRuntime,
  handleBtpmMcpRequest,
} from "../../functions/btpm-mcp/index.ts";
import { neverInvokedMcpRuntimeInput } from "../_shared/mcp/support/neverInvokedMcpRuntimeInput.ts";
import {
  authorizeMcpConnectedApp,
  McpConnectedAppAuthorizationError,
} from "../../functions/btpm-mcp/mcp/authorizeMcpConnectedApp.ts";
import {
  buildMcpInvalidTokenWwwAuthenticate,
  buildMcpWwwAuthenticate,
  mcpProtectedResourceMetadataUrl,
} from "../../functions/btpm-mcp/mcp/oauthProtectedResource.ts";
import { ApiAuthenticationError } from "../../functions/_shared/btpm-api/apiErrors.ts";
import type { TokenContextDependencies } from "../../functions/_shared/btpm-api/resolveTokenContext.ts";
import type {
  ClientAuthorizationStore,
  PolicyAcknowledgementRecord,
} from "../../functions/_shared/btpm-api/authorizeClient.ts";
import type { McpAuthenticationContext } from "../../functions/btpm-mcp/mcp/authenticateMcpRequest.ts";

const SUPABASE_URL = "https://example.supabase.co";
const RESOURCE_URI = `${SUPABASE_URL}/functions/v1/btpm-mcp`;
const BEARER = "opaque-test-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OAUTH_CLIENT_ID = "claude-oauth-client";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_POLICY_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const ACK_ID = "55555555-5555-4555-8555-555555555555";

const unused = () => Promise.reject(new Error("dependency must not be used"));

const AUTHENTICATED: McpAuthenticationContext = Object.freeze({
  userId: USER_ID,
  clientId: OAUTH_CLIENT_ID,
  issuer: `${SUPABASE_URL}/auth/v1`,
  audiences: Object.freeze([RESOURCE_URI]),
  expiresAt: 2_000,
  resourceUri: RESOURCE_URI,
  requestId: "req-1",
});

// -----------------------------------------------------------------------------
// Store builders
// -----------------------------------------------------------------------------

interface StoreOptions {
  clients?: () => Promise<
    { id: string; oauthClientId: string; lifecycleStatus: string }[]
  >;
  versions?: () => Promise<
    { id: string; apiClientId: string; lifecycleStatus: string }[]
  >;
  acknowledgement?: () => Promise<PolicyAcknowledgementRecord | null>;
}

function buildStore(options: StoreOptions = {}): ClientAuthorizationStore {
  return {
    findActiveClientsByOauthClientId: (options.clients ??
      (() =>
        Promise.resolve([
          {
            id: API_CLIENT_ID,
            oauthClientId: OAUTH_CLIENT_ID,
            lifecycleStatus: "active",
          },
        ]))) as ClientAuthorizationStore[
          "findActiveClientsByOauthClientId"
        ],
    findActivePolicyVersionsForClient: (options.versions ??
      (() =>
        Promise.resolve([
          {
            id: POLICY_VERSION_ID,
            apiClientId: API_CLIENT_ID,
            lifecycleStatus: "active",
          },
        ]))) as ClientAuthorizationStore[
          "findActivePolicyVersionsForClient"
        ],
    findUserAcknowledgement: (options.acknowledgement ??
      (() =>
        Promise.resolve({
          id: ACK_ID,
          userId: USER_ID,
          apiClientId: API_CLIENT_ID,
          policyVersionId: POLICY_VERSION_ID,
          revokedAt: null,
        }))) as ClientAuthorizationStore["findUserAcknowledgement"],
  };
}

const ACK_MISSING_STORE = buildStore({
  acknowledgement: () => Promise.resolve(null),
});
const ACK_STALE_STORE = buildStore({
  acknowledgement: () =>
    Promise.resolve({
      id: ACK_ID,
      userId: USER_ID,
      apiClientId: API_CLIENT_ID,
      policyVersionId: OTHER_POLICY_VERSION_ID,
      revokedAt: null,
    }),
});
const ACK_REVOKED_STORE = buildStore({
  acknowledgement: () =>
    Promise.resolve({
      id: ACK_ID,
      userId: USER_ID,
      apiClientId: API_CLIENT_ID,
      policyVersionId: POLICY_VERSION_ID,
      revokedAt: "2026-08-18T00:00:00.000Z",
    }),
});
const CLIENT_DISABLED_STORE = buildStore({ clients: () => Promise.resolve([]) });
const CLIENT_AMBIGUOUS_STORE = buildStore({
  clients: () =>
    Promise.resolve([
      {
        id: API_CLIENT_ID,
        oauthClientId: OAUTH_CLIENT_ID,
        lifecycleStatus: "active",
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        oauthClientId: OAUTH_CLIENT_ID,
        lifecycleStatus: "active",
      },
    ]),
});
const POLICY_MISSING_STORE = buildStore({
  versions: () => Promise.resolve([]),
});
const POLICY_AMBIGUOUS_STORE = buildStore({
  versions: () =>
    Promise.resolve([
      {
        id: POLICY_VERSION_ID,
        apiClientId: API_CLIENT_ID,
        lifecycleStatus: "active",
      },
      {
        id: OTHER_POLICY_VERSION_ID,
        apiClientId: API_CLIENT_ID,
        lifecycleStatus: "active",
      },
    ]),
});
const INTERNAL_FAILURE_STORE = buildStore({
  clients: () => Promise.reject(new Error("pg: relation api_clients denied")),
});
const HEALTHY_STORE = buildStore();

// -----------------------------------------------------------------------------
// A. Bounded classification
// -----------------------------------------------------------------------------

async function classify(
  store: ClientAuthorizationStore,
): Promise<McpConnectedAppAuthorizationError> {
  try {
    await authorizeMcpConnectedApp(AUTHENTICATED, store);
  } catch (error) {
    assert(error instanceof McpConnectedAppAuthorizationError);
    return error;
  }
  throw new Error("expected authorization failure");
}

Deno.test("UX-GAP.2C-A: recoverable policy states require reauthentication", async () => {
  for (
    const store of [ACK_MISSING_STORE, ACK_STALE_STORE, ACK_REVOKED_STORE]
  ) {
    const error = await classify(store);
    assertStrictEquals(error.reauthenticationRequired, true);
  }
});

Deno.test("UX-GAP.2C-A: non-recoverable failures never require reauthentication", async () => {
  for (
    const store of [
      CLIENT_DISABLED_STORE,
      CLIENT_AMBIGUOUS_STORE,
      POLICY_MISSING_STORE,
      POLICY_AMBIGUOUS_STORE,
      INTERNAL_FAILURE_STORE,
    ]
  ) {
    const error = await classify(store);
    assertStrictEquals(error.reauthenticationRequired, false);
  }
});

Deno.test("UX-GAP.2C-A: unknown non-ApiAuthenticationError is not recoverable", () => {
  const error = new McpConnectedAppAuthorizationError(new Error("boom"));
  assertStrictEquals(error.reauthenticationRequired, false);
  assertStrictEquals(new McpConnectedAppAuthorizationError().reauthenticationRequired, false);
});

Deno.test("UX-GAP.2C-A: no underlying code is exposed as a public property", async () => {
  const error = await classify(ACK_MISSING_STORE);
  const record = error as unknown as Record<string, unknown>;
  assertStrictEquals(record.code, undefined);
  assertStrictEquals(record.publicMessage, undefined);
  assertStrictEquals(record.internalCause, undefined);
  assertEquals(Object.keys(error).sort(), [
    "cause",
    "name",
    "reauthenticationRequired",
  ]);
  // The internal cause may remain for in-memory chaining, but the bounded
  // error itself exposes no governance reason on its own surface.
  assertStrictEquals(error.message, "mcp_connected_app_forbidden");

});

Deno.test("UX-GAP.2C-A: each accepted code classifies exactly", () => {
  for (
    const code of [
      "policy_acknowledgement_missing",
      "policy_acknowledgement_stale",
      "policy_acknowledgement_revoked",
    ] as const
  ) {
    assertStrictEquals(
      new McpConnectedAppAuthorizationError(new ApiAuthenticationError(code))
        .reauthenticationRequired,
      true,
    );
  }
  for (
    const code of [
      "client_disabled",
      "client_record_ambiguous",
      "active_policy_missing",
      "active_policy_ambiguous",
      "authentication_internal_error",
      "invalid_token",
    ] as const
  ) {
    assertStrictEquals(
      new McpConnectedAppAuthorizationError(new ApiAuthenticationError(code))
        .reauthenticationRequired,
      false,
    );
  }
});

// -----------------------------------------------------------------------------
// B. Challenge builder
// -----------------------------------------------------------------------------

Deno.test("UX-GAP.2C-B: invalid_token challenge shape is bounded", () => {
  const challenge = buildMcpInvalidTokenWwwAuthenticate(RESOURCE_URI);
  assertStrictEquals(
    challenge,
    `Bearer resource="${RESOURCE_URI}", ` +
      `resource_metadata="${mcpProtectedResourceMetadataUrl(RESOURCE_URI)}", ` +
      `error="invalid_token"`,
  );
  assert(challenge.startsWith("Bearer "));
  assert(challenge.includes(`error="invalid_token"`));
  for (
    const forbidden of [
      "error_description",
      "policy",
      "acknowledg",
      "scope",
      USER_ID,
      API_CLIENT_ID,
      POLICY_VERSION_ID,
      OAUTH_CLIENT_ID,
    ]
  ) {
    assert(!challenge.includes(forbidden), `challenge leaks ${forbidden}`);
  }
});

Deno.test("UX-GAP.2C-B: existing canonical challenge is unchanged", () => {
  assertStrictEquals(
    buildMcpWwwAuthenticate(RESOURCE_URI),
    `Bearer resource="${RESOURCE_URI}", ` +
      `resource_metadata="${RESOURCE_URI}/.well-known/oauth-protected-resource"`,
  );
  assert(!buildMcpWwwAuthenticate(RESOURCE_URI).includes("error="));
});

// -----------------------------------------------------------------------------
// Runtime harness
// -----------------------------------------------------------------------------

const VALID_TOKEN_DEPENDENCIES: TokenContextDependencies = {
  tokenVerifier: {
    verify: () =>
      Promise.resolve({
        iss: `${SUPABASE_URL}/auth/v1`,
        aud: [RESOURCE_URI],
        exp: 2_000,
        sub: USER_ID,
        client_id: OAUTH_CLIENT_ID,
      }),
  },
  currentUserResolver: { resolveCurrentUserId: () => Promise.resolve(USER_ID) },
  clock: { nowSeconds: () => 1_000 },
};

const INVALID_TOKEN_DEPENDENCIES: TokenContextDependencies = {
  tokenVerifier: {
    verify: () =>
      Promise.resolve({
        iss: `${SUPABASE_URL}/auth/v1`,
        aud: "authenticated",
        exp: 2_000,
        sub: USER_ID,
        client_id: OAUTH_CLIENT_ID,
      }),
  },
  currentUserResolver: { resolveCurrentUserId: unused },
  clock: { nowSeconds: () => 1_000 },
};

function buildRuntime(
  store: ClientAuthorizationStore,
  tokenDependencies: TokenContextDependencies = VALID_TOKEN_DEPENDENCIES,
) {
  return createBtpmMcpRuntime(neverInvokedMcpRuntimeInput({
    resourceUri: RESOURCE_URI,
    supabaseUrl: SUPABASE_URL,
    tokenDependencies,
    authorizationStore: store,
    organizationsReader: unused,
    workspacesReader: unused,
    projectsReader: unused,
    programsReader: unused,
    programReader: unused,
    projectDetailReader: unused,
    projectPlanningReader: unused,
    projectRisksReader: unused,
    riskReader: unused,
    projectBlockersReader: unused,
    blockerReader: unused,
    executionUpdatesReader: unused,
    phaseReader: unused,
    taskReader: unused,
    rateLimitProfileResolver: { resolve: unused },
    rateLimitStore: { consume: unused },
    now: () => 1_000_000,
  }));
}

function mcpRequest(): Request {
  return new Request(RESOURCE_URI, {
    method: "POST",
    headers: {
      authorization: `Bearer ${BEARER}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

async function run(
  store: ClientAuthorizationStore,
  tokenDependencies: TokenContextDependencies = VALID_TOKEN_DEPENDENCIES,
): Promise<{ response: Response; body: string; handlerReached: boolean }> {
  let handlerReached = false;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const response = await handleBtpmMcpRequest(
      mcpRequest(),
      buildRuntime(store, tokenDependencies),
      { onExecutionContext: () => { handlerReached = true; } },
    );
    return { response, body: await response.text(), handlerReached };
  } finally {
    console.warn = originalWarn;
  }
}

const LEAK_TOKENS = [
  "policy_acknowledgement_missing",
  "policy_acknowledgement_stale",
  "policy_acknowledgement_revoked",
  "active_policy_missing",
  "active_policy_ambiguous",
  "client_disabled",
  "client_record_ambiguous",
  "authentication_internal_error",
  POLICY_VERSION_ID,
  OTHER_POLICY_VERSION_ID,
  API_CLIENT_ID,
  ACK_ID,
  USER_ID,
  OAUTH_CLIENT_ID,
  BEARER,
  "pg:",
  "relation",
  "stack",
  "cause",
];

function assertNoLeak(response: Response, body: string): void {
  const serialized = `${body}\n${
    [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n")
  }`;
  for (const forbidden of LEAK_TOKENS) {
    assert(!serialized.includes(forbidden), `response leaks ${forbidden}`);
  }
}

async function assertReauthChallenge(
  store: ClientAuthorizationStore,
): Promise<void> {
  const { response, body, handlerReached } = await run(store);
  assertStrictEquals(response.status, 401);
  assertStrictEquals(response.headers.get("content-type"), "application/json");
  assertStrictEquals(
    response.headers.get("www-authenticate"),
    buildMcpInvalidTokenWwwAuthenticate(RESOURCE_URI),
  );
  assert(response.headers.get("www-authenticate")!.includes(
    `error="invalid_token"`,
  ));
  assertEquals(JSON.parse(body), {
    error: "unauthorized",
    message: "Authentication required.",
  });
  assertStrictEquals(handlerReached, false);
  assert(response.headers.get(BTPM_MCP_REQUEST_ID_HEADER) !== null);
  assertNoLeak(response, body);
}

async function assertForbidden(
  store: ClientAuthorizationStore,
): Promise<void> {
  const { response, body, handlerReached } = await run(store);
  assertStrictEquals(response.status, 403);
  assertStrictEquals(response.headers.get("www-authenticate"), null);
  assertEquals(JSON.parse(body), {
    error: "forbidden",
    message: "Connected App authorization denied.",
  });
  assertStrictEquals(handlerReached, false);
  assertNoLeak(response, body);
}

// C / D / E — recoverable policy states.
Deno.test("UX-GAP.2C-C: missing acknowledgement returns the reauth challenge", async () => {
  await assertReauthChallenge(ACK_MISSING_STORE);
});

Deno.test("UX-GAP.2C-D: stale acknowledgement returns the reauth challenge", async () => {
  await assertReauthChallenge(ACK_STALE_STORE);
});

Deno.test("UX-GAP.2C-E: revoked acknowledgement returns the reauth challenge", async () => {
  await assertReauthChallenge(ACK_REVOKED_STORE);
});

// F / G / H — non-recoverable failures keep the existing 403.
Deno.test("UX-GAP.2C-F: disabled client still returns 403 with no challenge", async () => {
  await assertForbidden(CLIENT_DISABLED_STORE);
  await assertForbidden(CLIENT_AMBIGUOUS_STORE);
});

Deno.test("UX-GAP.2C-G: missing/ambiguous active policy still returns 403", async () => {
  await assertForbidden(POLICY_MISSING_STORE);
  await assertForbidden(POLICY_AMBIGUOUS_STORE);
});

Deno.test("UX-GAP.2C-H: internal store failure still returns generic 403", async () => {
  await assertForbidden(INTERNAL_FAILURE_STORE);
});

// I — existing authentication 401 unchanged.
Deno.test("UX-GAP.2C-I: authentication failure keeps the existing 401 challenge", async () => {
  const { response, body, handlerReached } = await run(
    HEALTHY_STORE,
    INVALID_TOKEN_DEPENDENCIES,
  );
  assertStrictEquals(response.status, 401);
  assertStrictEquals(
    response.headers.get("www-authenticate"),
    buildMcpWwwAuthenticate(RESOURCE_URI),
  );
  assert(!response.headers.get("www-authenticate")!.includes("error="));
  assertEquals(JSON.parse(body), {
    error: "unauthorized",
    message: "Authentication required.",
  });
  assertStrictEquals(handlerReached, false);
  assertNoLeak(response, body);
});

// J — successful authorization still reaches the MCP handler.
Deno.test("UX-GAP.2C-J: acknowledged request reaches the MCP handler", async () => {
  const { response, handlerReached } = await run(HEALTHY_STORE);
  assertStrictEquals(handlerReached, true);
  assertStrictEquals(response.status !== 401, true);
  assertStrictEquals(response.status !== 403, true);
});
