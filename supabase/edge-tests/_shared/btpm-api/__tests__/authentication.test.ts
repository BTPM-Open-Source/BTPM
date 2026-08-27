// API-E.R3 — Shared Edge Authentication Middleware Foundation.
//
// Focused unit tests. Fully dependency-injected: no live Supabase,
// database, real OAuth client, environment secret, or network call.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ApiAuthenticationError,
  toSafeErrorResponse,
} from "../../../../functions/_shared/btpm-api/apiErrors.ts";
import {
  authenticateApiRequest,
  type AuthenticateApiRequestConfig,
  type AuthenticateApiRequestDependencies,
} from "../../../../functions/_shared/btpm-api/authenticateApiRequest.ts";
import type {
  CurrentUserResolver,
  TokenVerifier,
  VerifiedTokenClaims,
} from "../../../../functions/_shared/btpm-api/resolveTokenContext.ts";
import type {
  ActiveApiClientRecord,
  ActivePolicyVersionRecord,
  ClientAuthorizationStore,
  PolicyAcknowledgementRecord,
} from "../../../../functions/_shared/btpm-api/authorizeClient.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const NOW = 1_700_000_000;
const USER_ID = "11111111-1111-1111-1111-111111111111";
const SIGNED_CLIENT_ID = "svc.internal.reporting";
const ISSUER = "https://example.supabase.co/auth/v1";
const AUDIENCE = "btpm-api";
const TOKEN = "opaque.test.token";

const ACTIVE_CLIENT: ActiveApiClientRecord = {
  id: "client-internal-1",
  oauthClientId: SIGNED_CLIENT_ID,
  lifecycleStatus: "active",
};

const ACTIVE_POLICY: ActivePolicyVersionRecord = {
  id: "policy-version-1",
  apiClientId: ACTIVE_CLIENT.id,
  lifecycleStatus: "active",
};

const VALID_ACK: PolicyAcknowledgementRecord = {
  id: "ack-1",
  userId: USER_ID,
  apiClientId: ACTIVE_CLIENT.id,
  policyVersionId: ACTIVE_POLICY.id,
  revokedAt: null,
};

function baseClaims(overrides: Partial<VerifiedTokenClaims> = {}): VerifiedTokenClaims {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    exp: NOW + 3600,
    sub: USER_ID,
    client_id: SIGNED_CLIENT_ID,
    ...overrides,
  };
}

interface Recorder {
  storeFindActiveClientsCalls: number;
  storeFindPolicyVersionsCalls: number;
  storeFindAckCalls: number;
  lastAckArgs: { userId: string; apiClientId: string; policyVersionId: string } | null;
  lastClientQuery: string | null;
}

function makeDeps(overrides: {
  claims?: VerifiedTokenClaims | null;
  verifyThrows?: unknown;
  currentUserId?: string | null;
  currentUserThrows?: unknown;
  clients?: ActiveApiClientRecord[];
  clientsThrows?: unknown;
  policies?: ActivePolicyVersionRecord[];
  policiesThrows?: unknown;
  ack?: PolicyAcknowledgementRecord | null;
  ackThrows?: unknown;
  now?: number;
} = {}): { deps: AuthenticateApiRequestDependencies; rec: Recorder } {
  const rec: Recorder = {
    storeFindActiveClientsCalls: 0,
    storeFindPolicyVersionsCalls: 0,
    storeFindAckCalls: 0,
    lastAckArgs: null,
    lastClientQuery: null,
  };

  const tokenVerifier: TokenVerifier = {
    verify: async (_t) => {
      if (overrides.verifyThrows !== undefined) throw overrides.verifyThrows;
      return overrides.claims === undefined ? baseClaims() : (overrides.claims as VerifiedTokenClaims);
    },
  };

  const currentUserResolver: CurrentUserResolver = {
    resolveCurrentUserId: async (_t) => {
      if (overrides.currentUserThrows !== undefined) throw overrides.currentUserThrows;
      return overrides.currentUserId === undefined ? USER_ID : overrides.currentUserId;
    },
  };

  const clientAuthorizationStore: ClientAuthorizationStore = {
    findActiveClientsByOauthClientId: async (oauthClientId) => {
      rec.storeFindActiveClientsCalls++;
      rec.lastClientQuery = oauthClientId;
      if (overrides.clientsThrows !== undefined) throw overrides.clientsThrows;
      return overrides.clients ?? [ACTIVE_CLIENT];
    },
    findActivePolicyVersionsForClient: async (_clientId) => {
      rec.storeFindPolicyVersionsCalls++;
      if (overrides.policiesThrows !== undefined) throw overrides.policiesThrows;
      return overrides.policies ?? [ACTIVE_POLICY];
    },
    findUserAcknowledgement: async (userId, apiClientId, policyVersionId) => {
      rec.storeFindAckCalls++;
      rec.lastAckArgs = { userId, apiClientId, policyVersionId };
      if (overrides.ackThrows !== undefined) throw overrides.ackThrows;
      return overrides.ack === undefined ? VALID_ACK : overrides.ack;
    },
  };

  const deps: AuthenticateApiRequestDependencies = {
    tokenVerifier,
    currentUserResolver,
    clock: { nowSeconds: () => overrides.now ?? NOW },
    clientAuthorizationStore,
  };
  return { deps, rec };
}

const CONFIG: AuthenticateApiRequestConfig = {
  expectedIssuer: ISSUER,
  expectedAudience: AUDIENCE,
};

function reqWith(headers: Record<string, string> = {}): Request {
  return new Request("https://example.local/api", { headers });
}
function reqBearer(token = TOKEN, extra: Record<string, string> = {}): Request {
  return reqWith({ Authorization: `Bearer ${token}`, ...extra });
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: ApiAuthenticationError["code"],
) {
  const err = await assertRejects(fn, ApiAuthenticationError);
  assertEquals((err as ApiAuthenticationError).code, code);
  return err as ApiAuthenticationError;
}

// -----------------------------------------------------------------------------
// Successful authentication
// -----------------------------------------------------------------------------

Deno.test("success — string audience", async () => {
  const { deps } = makeDeps();
  const ctx = await authenticateApiRequest(reqBearer(), CONFIG, deps);
  assertEquals(ctx.token.userId, USER_ID);
  assertEquals(ctx.token.clientId, SIGNED_CLIENT_ID);
  assertEquals(ctx.token.issuer, ISSUER);
  assertEquals(ctx.token.audiences, [AUDIENCE]);
  assertEquals(ctx.client.apiClientId, ACTIVE_CLIENT.id);
  assertEquals(ctx.client.oauthClientId, SIGNED_CLIENT_ID);
  assertEquals(ctx.client.policyVersionId, ACTIVE_POLICY.id);
});

Deno.test("success — array audience contains expected", async () => {
  const { deps } = makeDeps({
    claims: baseClaims({ aud: ["other", AUDIENCE, "more"] }),
  });
  const ctx = await authenticateApiRequest(reqBearer(), CONFIG, deps);
  assertEquals(ctx.token.audiences.includes(AUDIENCE), true);
});

// -----------------------------------------------------------------------------
// Bearer failures
// -----------------------------------------------------------------------------

Deno.test("bearer — missing Authorization header", async () => {
  const { deps } = makeDeps();
  await expectCode(
    () => authenticateApiRequest(reqWith(), CONFIG, deps),
    "missing_bearer_token",
  );
});

Deno.test("bearer — wrong scheme", async () => {
  const { deps } = makeDeps();
  await expectCode(
    () =>
      authenticateApiRequest(
        reqWith({ Authorization: `Basic ${TOKEN}` }),
        CONFIG,
        deps,
      ),
    "malformed_bearer_token",
  );
});

Deno.test("bearer — empty token after scheme", async () => {
  const { deps } = makeDeps();
  await expectCode(
    () =>
      authenticateApiRequest(
        reqWith({ Authorization: "Bearer " }),
        CONFIG,
        deps,
      ),
    "missing_bearer_token",
  );
});

Deno.test("bearer — malformed combined credentials", async () => {
  const { deps } = makeDeps();
  await expectCode(
    () =>
      authenticateApiRequest(
        reqWith({ Authorization: `Bearer ${TOKEN}, Bearer other` }),
        CONFIG,
        deps,
      ),
    "malformed_bearer_token",
  );
});

Deno.test("bearer — multiple credentials (space)", async () => {
  const { deps } = makeDeps();
  await expectCode(
    () =>
      authenticateApiRequest(
        reqWith({ Authorization: `Bearer ${TOKEN} extra` }),
        CONFIG,
        deps,
      ),
    "malformed_bearer_token",
  );
});

// -----------------------------------------------------------------------------
// Token failures
// -----------------------------------------------------------------------------

Deno.test("token — verifier rejects", async () => {
  const { deps } = makeDeps({ verifyThrows: new Error("bad sig") });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_token",
  );
});

Deno.test("token — wrong issuer", async () => {
  const { deps } = makeDeps({ claims: baseClaims({ iss: "https://evil" }) });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_issuer",
  );
});

Deno.test("token — wrong audience (string)", async () => {
  const { deps } = makeDeps({ claims: baseClaims({ aud: "some-other-aud" }) });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_audience",
  );
});

Deno.test("token — wrong audience (array)", async () => {
  const { deps } = makeDeps({ claims: baseClaims({ aud: ["a", "b"] }) });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_audience",
  );
});

Deno.test("token — expired token", async () => {
  const { deps } = makeDeps({ claims: baseClaims({ exp: NOW - 1 }) });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "token_expired",
  );
});

Deno.test("token — expiry equal to current time (strictly later required)", async () => {
  const { deps } = makeDeps({ claims: baseClaims({ exp: NOW }) });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "token_expired",
  );
});

Deno.test("token — missing subject", async () => {
  const { deps } = makeDeps({
    claims: baseClaims({ sub: "" as unknown as string }),
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "missing_subject",
  );
});

Deno.test("token — invalid subject (non-string)", async () => {
  const { deps } = makeDeps({
    claims: baseClaims({ sub: 42 as unknown as string }),
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "missing_subject",
  );
});

Deno.test("token — missing signed client_id", async () => {
  const { deps } = makeDeps({
    claims: baseClaims({ client_id: "" as unknown as string }),
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "missing_client_id",
  );
});

Deno.test("token — malformed signed client_id", async () => {
  const { deps } = makeDeps({
    claims: baseClaims({ client_id: "has spaces and $$$" }),
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_client_id",
  );
});

// -----------------------------------------------------------------------------
// User/session failures
// -----------------------------------------------------------------------------

Deno.test("session — no current user", async () => {
  const { deps } = makeDeps({ currentUserId: null });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_session",
  );
});

Deno.test("session — current user resolution failure", async () => {
  const { deps } = makeDeps({ currentUserThrows: new Error("boom") });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_session",
  );
});

Deno.test("session — verified sub differs from returned user id", async () => {
  const { deps } = makeDeps({ currentUserId: "another-user-id" });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "subject_mismatch",
  );
});

// -----------------------------------------------------------------------------
// Client-policy failures
// -----------------------------------------------------------------------------

Deno.test("client — no active matching client", async () => {
  const { deps } = makeDeps({ clients: [] });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "client_disabled",
  );
});

Deno.test("client — disabled/suspended client", async () => {
  const { deps } = makeDeps({
    clients: [{ ...ACTIVE_CLIENT, lifecycleStatus: "suspended" }],
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "client_disabled",
  );
});

Deno.test("client — multiple active client rows", async () => {
  const { deps } = makeDeps({
    clients: [ACTIVE_CLIENT, { ...ACTIVE_CLIENT, id: "client-internal-2" }],
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "client_record_ambiguous",
  );
});

Deno.test("policy — no current active policy", async () => {
  const { deps } = makeDeps({ policies: [] });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "active_policy_missing",
  );
});

Deno.test("policy — multiple current active policies", async () => {
  const { deps } = makeDeps({
    policies: [ACTIVE_POLICY, { ...ACTIVE_POLICY, id: "policy-version-2" }],
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "active_policy_ambiguous",
  );
});

Deno.test("ack — no acknowledgement", async () => {
  const { deps } = makeDeps({ ack: null });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "policy_acknowledgement_missing",
  );
});

Deno.test("ack — revoked acknowledgement", async () => {
  const { deps } = makeDeps({
    ack: { ...VALID_ACK, revokedAt: "2025-01-01T00:00:00Z" },
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "policy_acknowledgement_revoked",
  );
});

Deno.test("ack — older policy version (stale)", async () => {
  const { deps } = makeDeps({
    ack: { ...VALID_ACK, policyVersionId: "policy-version-OLD" },
  });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "policy_acknowledgement_stale",
  );
});

// -----------------------------------------------------------------------------
// Authority and disclosure guards
// -----------------------------------------------------------------------------

Deno.test("authority — forged X-BTPM-Client-ID header is ignored", async () => {
  const { deps, rec } = makeDeps();
  const req = reqBearer(TOKEN, {
    "X-BTPM-Client-ID": "attacker.client",
    "x-client-id": "attacker.client",
  });
  const ctx = await authenticateApiRequest(req, CONFIG, deps);
  assertEquals(ctx.token.clientId, SIGNED_CLIENT_ID);
  assertEquals(rec.lastClientQuery, SIGNED_CLIENT_ID);
});

Deno.test("authority — body/query values cannot override signed client_id", async () => {
  // Middleware never reads the request body or query. Confirm success even
  // when a URL query parameter would suggest a different client identity.
  const { deps } = makeDeps();
  const req = new Request(
    "https://example.local/api?client_id=attacker.client",
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  const ctx = await authenticateApiRequest(req, CONFIG, deps);
  assertEquals(ctx.token.clientId, SIGNED_CLIENT_ID);
});

Deno.test("disclosure — serialized errors contain no token, claims or db cause", async () => {
  const { deps } = makeDeps({
    verifyThrows: new Error(
      `DB ERROR: SELECT * FROM api_clients token=${TOKEN} claims={"sub":"${USER_ID}"} secret=service_role_key_XYZ`,
    ),
  });
  const err = await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_token",
  );
  const response = toSafeErrorResponse(err);
  const body = await response.text();
  assert(!body.includes(TOKEN));
  assert(!body.includes(USER_ID));
  assert(!body.includes("service_role_key_XYZ"));
  assert(!body.includes("SELECT"));
  assert(!body.includes("api_clients"));
  assertEquals(response.status, 401);
  const parsed = JSON.parse(body) as { error: { code: string } };
  assertEquals(parsed.error.code, "invalid_token");
});

Deno.test("disclosure — unknown failures return generic safe internal error", async () => {
  const response = toSafeErrorResponse(
    new Error("unexpected raw internal detail with sensitive=data"),
  );
  const body = await response.text();
  assertEquals(response.status, 500);
  assert(!body.includes("sensitive=data"));
  const parsed = JSON.parse(body) as { error: { code: string; message: string } };
  assertEquals(parsed.error.code, "authentication_internal_error");
  assertEquals(parsed.error.message, "Internal server error.");
});

Deno.test("disclosure — ApiAuthenticationError.toJSON excludes internalCause", () => {
  const err = new ApiAuthenticationError("invalid_token", {
    secret: "service_role_key_XYZ",
  });
  const json = JSON.stringify(err.toJSON());
  assert(!json.includes("service_role_key_XYZ"));
  assert(!json.includes("internalCause"));
});

// -----------------------------------------------------------------------------
// Composition
// -----------------------------------------------------------------------------

Deno.test("composition — client store is NOT called when token validation fails", async () => {
  const { deps, rec } = makeDeps({ claims: baseClaims({ iss: "https://evil" }) });
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, deps),
    "invalid_issuer",
  );
  assertStrictEquals(rec.storeFindActiveClientsCalls, 0);
  assertStrictEquals(rec.storeFindPolicyVersionsCalls, 0);
  assertStrictEquals(rec.storeFindAckCalls, 0);
});

Deno.test("composition — client store receives verified user id and signed client id", async () => {
  const { deps, rec } = makeDeps();
  await authenticateApiRequest(reqBearer(), CONFIG, deps);
  assertEquals(rec.lastClientQuery, SIGNED_CLIENT_ID);
  assertEquals(rec.lastAckArgs, {
    userId: USER_ID,
    apiClientId: ACTIVE_CLIENT.id,
    policyVersionId: ACTIVE_POLICY.id,
  });
});

Deno.test("composition — returned context does not include raw token or full claims", async () => {
  const { deps } = makeDeps();
  const ctx = await authenticateApiRequest(reqBearer(), CONFIG, deps);
  const serialized = JSON.stringify(ctx);
  assert(!serialized.includes(TOKEN));
  // Ensure no arbitrary claim key leaked in (only the minimal projection).
  const tokenKeys = Object.keys(ctx.token).sort();
  assertEquals(tokenKeys, [
    "audiences",
    "clientId",
    "expiresAt",
    "issuer",
    "userId",
  ]);
  const clientKeys = Object.keys(ctx.client).sort();
  assertEquals(clientKeys, [
    "apiClientId",
    "oauthClientId",
    "policyVersionId",
    "userId",
  ]);
});

// -----------------------------------------------------------------------------
// Supabase adapter tests — token verifier
// -----------------------------------------------------------------------------

import {
  createSupabaseTokenVerifier,
  createSupabaseCurrentUserResolver,
  type SupabaseAuthAdapterClient,
} from "../../../../functions/_shared/btpm-api/resolveTokenContext.ts";
import {
  createSupabaseClientAuthorizationStore,
  type SupabaseAuthorizationServerClient,
} from "../../../../functions/_shared/btpm-api/authorizeClient.ts";

function makeAuthClient(overrides: {
  claims?: Record<string, unknown> | null;
  claimsError?: unknown;
  user?: { id?: string | null } | null;
  userError?: unknown;
  onGetClaims?: (t: string) => void;
  onGetUser?: (t: string) => void;
}): SupabaseAuthAdapterClient {
  return {
    auth: {
      getClaims: async (t: string) => {
        overrides.onGetClaims?.(t);
        return {
          data: overrides.claims === undefined ? { claims: baseClaims() as unknown as Record<string, unknown> } : { claims: overrides.claims },
          error: overrides.claimsError ?? null,
        };
      },
      getUser: async (t: string) => {
        overrides.onGetUser?.(t);
        return {
          data: overrides.user === undefined ? { user: { id: USER_ID } } : { user: overrides.user },
          error: overrides.userError ?? null,
        };
      },
    },
  };
}

Deno.test("adapter/token — getClaims success returns claims", async () => {
  const verifier = createSupabaseTokenVerifier(makeAuthClient({}));
  const c = await verifier.verify(TOKEN);
  assertEquals(c.sub, USER_ID);
  assertEquals(c.client_id, SIGNED_CLIENT_ID);
});

Deno.test("adapter/token — Supabase error rejects", async () => {
  const verifier = createSupabaseTokenVerifier(
    makeAuthClient({ claimsError: { message: "sig fail" } }),
  );
  await assertRejects(() => verifier.verify(TOKEN), Error);
});

Deno.test("adapter/token — missing claims object rejects", async () => {
  const verifier = createSupabaseTokenVerifier(
    makeAuthClient({ claims: null }),
  );
  await assertRejects(() => verifier.verify(TOKEN), Error);
});

Deno.test("adapter/token — malformed (array) claims rejects", async () => {
  const verifier = createSupabaseTokenVerifier(
    makeAuthClient({ claims: [] as unknown as Record<string, unknown> }),
  );
  await assertRejects(() => verifier.verify(TOKEN), Error);
});

Deno.test("adapter/token — exact bearer token forwarded to getClaims", async () => {
  let seen: string | null = null;
  const verifier = createSupabaseTokenVerifier(
    makeAuthClient({ onGetClaims: (t) => (seen = t) }),
  );
  await verifier.verify(TOKEN);
  assertEquals(seen, TOKEN);
});

Deno.test("adapter/token — public middleware context contains no token or claims payload", async () => {
  const authClient = makeAuthClient({});
  const verifier = createSupabaseTokenVerifier(authClient);
  const resolver = createSupabaseCurrentUserResolver(authClient);
  const deps: AuthenticateApiRequestDependencies = {
    tokenVerifier: verifier,
    currentUserResolver: resolver,
    clock: { nowSeconds: () => NOW },
    clientAuthorizationStore: {
      findActiveClientsByOauthClientId: async () => [ACTIVE_CLIENT],
      findActivePolicyVersionsForClient: async () => [ACTIVE_POLICY],
      findUserAcknowledgement: async () => VALID_ACK,
    },
  };
  const ctx = await authenticateApiRequest(reqBearer(), CONFIG, deps);
  const s = JSON.stringify(ctx);
  assert(!s.includes(TOKEN));
  assert(!s.includes("claims"));
});

// -----------------------------------------------------------------------------
// Supabase adapter tests — current-user resolver
// -----------------------------------------------------------------------------

Deno.test("adapter/user — valid user id returned", async () => {
  const r = createSupabaseCurrentUserResolver(makeAuthClient({}));
  assertEquals(await r.resolveCurrentUserId(TOKEN), USER_ID);
});

Deno.test("adapter/user — no current user returns null", async () => {
  const r = createSupabaseCurrentUserResolver(makeAuthClient({ user: null }));
  assertEquals(await r.resolveCurrentUserId(TOKEN), null);
});

Deno.test("adapter/user — Auth error rejects", async () => {
  const r = createSupabaseCurrentUserResolver(
    makeAuthClient({ userError: { message: "boom" } }),
  );
  await assertRejects(() => r.resolveCurrentUserId(TOKEN), Error);
});

Deno.test("adapter/user — malformed user record returns null", async () => {
  const r = createSupabaseCurrentUserResolver(
    makeAuthClient({ user: { id: 42 as unknown as string } }),
  );
  assertEquals(await r.resolveCurrentUserId(TOKEN), null);
});

Deno.test("adapter/user — exact token forwarded to getUser", async () => {
  let seen: string | null = null;
  const r = createSupabaseCurrentUserResolver(
    makeAuthClient({ onGetUser: (t) => (seen = t) }),
  );
  await r.resolveCurrentUserId(TOKEN);
  assertEquals(seen, TOKEN);
});

// -----------------------------------------------------------------------------
// Supabase adapter tests — client-authorization store
// -----------------------------------------------------------------------------

interface QueryLog {
  table: string;
  columns: string;
  eqs: Array<[string, unknown]>;
  limit: number | null;
}

function makeServerClient(handlers: {
  api_clients?: (q: QueryLog) => { data: unknown[] | null; error: unknown };
  api_client_policy_versions?: (q: QueryLog) => { data: unknown[] | null; error: unknown };
  api_user_policy_acknowledgements?: (q: QueryLog) => { data: unknown[] | null; error: unknown };
  onQuery?: (q: QueryLog) => void;
}): SupabaseAuthorizationServerClient {
  return {
    from(table: string) {
      const q: QueryLog = { table, columns: "", eqs: [], limit: null };
      const builder: any = {
        select(cols: string) { q.columns = cols; return builder; },
        eq(c: string, v: unknown) { q.eqs.push([c, v]); return builder; },
        limit(n: number) { q.limit = n; return builder; },
        then(resolve: any, reject: any) {
          try {
            handlers.onQuery?.(q);
            const h = (handlers as any)[table];
            const result = h ? h(q) : { data: [], error: null };
            resolve(result);
          } catch (e) { reject(e); }
        },
      };
      return builder;
    },
  };
}

Deno.test("adapter/store — clients: exact table, columns, filters, limit; snake→camel", async () => {
  let seen: QueryLog | null = null; const cap = (q: QueryLog) => { seen = q; };
  const store = createSupabaseClientAuthorizationStore(
    makeServerClient({
      onQuery: (q) => { if (q.table === "api_clients") seen = q; },
      api_clients: () => ({
        data: [{ id: "c1", oauth_client_id: SIGNED_CLIENT_ID, lifecycle_status: "active" }],
        error: null,
      }),
    }),
  );
  const rows = await store.findActiveClientsByOauthClientId(SIGNED_CLIENT_ID);
  assertEquals(rows, [{ id: "c1", oauthClientId: SIGNED_CLIENT_ID, lifecycleStatus: "active" }]);
  assert(seen !== null);
  assertEquals((seen as unknown as QueryLog).table, "api_clients");
  assertEquals((seen as unknown as QueryLog).columns, "id, oauth_client_id, lifecycle_status");
  assertEquals((seen as unknown as QueryLog).eqs, [["oauth_client_id", SIGNED_CLIENT_ID], ["lifecycle_status", "active"]]);
  assertEquals((seen as unknown as QueryLog).limit, 2);
});

Deno.test("adapter/store — policy versions: exact table, columns, filters, limit", async () => {
  let seen: QueryLog | null = null; const cap = (q: QueryLog) => { seen = q; };
  const store = createSupabaseClientAuthorizationStore(
    makeServerClient({
      onQuery: (q) => { if (q.table === "api_client_policy_versions") seen = q; },
      api_client_policy_versions: () => ({
        data: [{ id: "v1", api_client_id: "c1", lifecycle_status: "active" }],
        error: null,
      }),
    }),
  );
  const rows = await store.findActivePolicyVersionsForClient("c1");
  assertEquals(rows, [{ id: "v1", apiClientId: "c1", lifecycleStatus: "active" }]);
  assertEquals((seen as unknown as QueryLog).table, "api_client_policy_versions");
  assertEquals((seen as unknown as QueryLog).columns, "id, api_client_id, lifecycle_status");
  assertEquals((seen as unknown as QueryLog).eqs, [["api_client_id", "c1"], ["lifecycle_status", "active"]]);
  assertEquals((seen as unknown as QueryLog).limit, 2);
});

Deno.test("adapter/store — ack: exact table, columns, filters including api_client_id, limit", async () => {
  let seen: QueryLog | null = null; const cap = (q: QueryLog) => { seen = q; };
  const store = createSupabaseClientAuthorizationStore(
    makeServerClient({
      onQuery: (q) => { if (q.table === "api_user_policy_acknowledgements") seen = q; },
      api_user_policy_acknowledgements: () => ({
        data: [{ id: "a1", user_id: USER_ID, api_client_id: "c1", policy_version_id: "v1", revoked_at: null }],
        error: null,
      }),
    }),
  );
  const ack = await store.findUserAcknowledgement(USER_ID, "c1", "v1");
  assertEquals(ack, { id: "a1", userId: USER_ID, apiClientId: "c1", policyVersionId: "v1", revokedAt: null });
  assertEquals((seen as unknown as QueryLog).table, "api_user_policy_acknowledgements");
  assertEquals((seen as unknown as QueryLog).columns, "id, user_id, api_client_id, policy_version_id, revoked_at");
  assertEquals((seen as unknown as QueryLog).eqs, [
    ["user_id", USER_ID],
    ["api_client_id", "c1"],
    ["policy_version_id", "v1"],
  ]);
  assertEquals((seen as unknown as QueryLog).limit, 2);
});

Deno.test("adapter/store — ack: zero rows returns null", async () => {
  const store = createSupabaseClientAuthorizationStore(
    makeServerClient({
      api_user_policy_acknowledgements: () => ({ data: [], error: null }),
    }),
  );
  assertEquals(await store.findUserAcknowledgement(USER_ID, "c1", "v1"), null);
});

Deno.test("adapter/store — query error propagates and is mapped to safe internal error by authorizeClient", async () => {
  const store = createSupabaseClientAuthorizationStore(
    makeServerClient({
      api_clients: () => ({ data: null, error: { message: "db down" } }),
    }),
  );
  await assertRejects(() => store.findActiveClientsByOauthClientId(SIGNED_CLIENT_ID), Error);

  const { deps } = makeDeps();
  const authDeps: AuthenticateApiRequestDependencies = {
    ...deps,
    clientAuthorizationStore: store,
  };
  await expectCode(
    () => authenticateApiRequest(reqBearer(), CONFIG, authDeps),
    "authentication_internal_error",
  );
});

Deno.test("adapter/store — malformed row fails safely", async () => {
  const store = createSupabaseClientAuthorizationStore(
    makeServerClient({
      api_clients: () => ({ data: [{ id: 123, oauth_client_id: SIGNED_CLIENT_ID, lifecycle_status: "active" }], error: null }),
    }),
  );
  await assertRejects(() => store.findActiveClientsByOauthClientId(SIGNED_CLIENT_ID), Error);
});

Deno.test("adapter/store — duplicate acknowledgement rows fail safely", async () => {
  const dup = { id: "a1", user_id: USER_ID, api_client_id: "c1", policy_version_id: "v1", revoked_at: null };
  const store = createSupabaseClientAuthorizationStore(
    makeServerClient({
      api_user_policy_acknowledgements: () => ({ data: [dup, { ...dup, id: "a2" }], error: null }),
    }),
  );
  await assertRejects(() => store.findUserAcknowledgement(USER_ID, "c1", "v1"), Error);
});

Deno.test("adapter/store — authenticated context contains no db row, client, or credential", async () => {
  const store = createSupabaseClientAuthorizationStore(
    makeServerClient({
      api_clients: () => ({ data: [{ id: "c1", oauth_client_id: SIGNED_CLIENT_ID, lifecycle_status: "active" }], error: null }),
      api_client_policy_versions: () => ({ data: [{ id: "v1", api_client_id: "c1", lifecycle_status: "active" }], error: null }),
      api_user_policy_acknowledgements: () => ({ data: [{ id: "a1", user_id: USER_ID, api_client_id: "c1", policy_version_id: "v1", revoked_at: null }], error: null }),
    }),
  );
  const { deps } = makeDeps();
  const authDeps: AuthenticateApiRequestDependencies = { ...deps, clientAuthorizationStore: store };
  const ctx = await authenticateApiRequest(reqBearer(), CONFIG, authDeps);
  const s = JSON.stringify(ctx);
  assert(!s.includes("service_role"));
  assert(!s.includes("revoked_at"));
  assert(!s.includes("oauth_client_id"));
  assert(!s.includes(TOKEN));
});
