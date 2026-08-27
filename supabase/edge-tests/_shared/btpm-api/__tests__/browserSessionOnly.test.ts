// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/browserSessionOnly.test.ts', import.meta.url).href;
// API-E.R4A — Browser-Only OAuth Denial Guard tests.
//
// Uses dependency-injected fake token verifiers only. No live Supabase,
// database, environment, secrets or network is required.

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { assertBrowserSessionOnly } from "../../../../functions/_shared/btpm-api/assertBrowserSessionOnly.ts";
import { ApiAuthenticationError, toSafeErrorResponse } from "../../../../functions/_shared/btpm-api/apiErrors.ts";
import type { TokenVerifier } from "../../../../functions/_shared/btpm-api/resolveTokenContext.ts";

const ENDPOINT_URL = "https://example.test/functions/v1/openai-test-connection";
const VALID_BEARER = "Bearer opaque.token.value";

function makeRequest(init: {
  headers?: Record<string, string>;
  url?: string;
  method?: string;
  body?: BodyInit | null;
} = {}): Request {
  return new Request(init.url ?? ENDPOINT_URL, {
    method: init.method ?? "POST",
    headers: init.headers ?? { Authorization: VALID_BEARER },
    body: init.body ?? null,
  });
}

function verifierReturning(claims: unknown): TokenVerifier {
  return {
    // deno-lint-ignore require-await
    async verify(_token: string) {
      return claims as never;
    },
  };
}

function verifierThrowing(cause: unknown): TokenVerifier {
  return {
    // deno-lint-ignore require-await
    async verify(_token: string) {
      throw cause instanceof Error ? cause : new Error(String(cause));
    },
  };
}

// -----------------------------------------------------------------------------
// Happy-path browser session
// -----------------------------------------------------------------------------

Deno.test("verified claims without client_id are accepted as browser session", async () => {
  const request = makeRequest();
  const verifier = verifierReturning({
    iss: "https://issuer.example",
    aud: "https://api.example",
    sub: "user-1",
    exp: 9_999_999_999,
  });
  await assertBrowserSessionOnly(request, verifier);
});

// -----------------------------------------------------------------------------
// Signed client_id in any form is rejected
// -----------------------------------------------------------------------------

async function assertClientDisabled(claims: unknown) {
  const request = makeRequest();
  const error = await assertRejects(
    () => assertBrowserSessionOnly(request, verifierReturning(claims)),
    ApiAuthenticationError,
  );
  assertEquals(error.code, "client_disabled");
  assertEquals(error.status, 403);
}

Deno.test("signed string client_id is rejected", async () => {
  await assertClientDisabled({ sub: "u", client_id: "external-app" });
});

Deno.test("empty signed client_id is rejected", async () => {
  await assertClientDisabled({ sub: "u", client_id: "" });
});

Deno.test("null signed client_id is rejected", async () => {
  await assertClientDisabled({ sub: "u", client_id: null });
});

Deno.test("owned undefined client_id is rejected", async () => {
  const claims: Record<string, unknown> = { sub: "u" };
  claims.client_id = undefined; // owned property with undefined value
  await assertClientDisabled(claims);
});

Deno.test("numeric signed client_id is rejected", async () => {
  await assertClientDisabled({ sub: "u", client_id: 42 });
});

Deno.test("array signed client_id is rejected", async () => {
  await assertClientDisabled({ sub: "u", client_id: ["a", "b"] });
});

Deno.test("object signed client_id is rejected", async () => {
  await assertClientDisabled({ sub: "u", client_id: { id: "x" } });
});

// -----------------------------------------------------------------------------
// Verifier / claim-shape failures
// -----------------------------------------------------------------------------

Deno.test("verifier failure maps to invalid_token", async () => {
  const request = makeRequest();
  const err = await assertRejects(
    () =>
      assertBrowserSessionOnly(
        request,
        verifierThrowing(new Error("verify_failed")),
      ),
    ApiAuthenticationError,
  );
  assertEquals(err.code, "invalid_token");
  assertEquals(err.status, 401);
  // Safe serialization must not leak the underlying cause message.
  const serialized = JSON.stringify(err.toJSON());
  if (serialized.includes("verify_failed")) {
    throw new Error("verifier cause leaked into safe serialization");
  }
});

Deno.test("missing/non-object claims map to invalid_token", async () => {
  for (const bogus of [null, undefined, "not-an-object", 123, ["array"]]) {
    const err = await assertRejects(
      () =>
        assertBrowserSessionOnly(makeRequest(), verifierReturning(bogus)),
      ApiAuthenticationError,
    );
    assertEquals(err.code, "invalid_token");
  }
});

// -----------------------------------------------------------------------------
// Bearer extraction errors from extractBearerToken
// -----------------------------------------------------------------------------

Deno.test("missing bearer token uses missing_bearer_token", async () => {
  const request = makeRequest({ headers: {} });
  const err = await assertRejects(
    () => assertBrowserSessionOnly(request, verifierReturning({ sub: "u" })),
    ApiAuthenticationError,
  );
  assertEquals(err.code, "missing_bearer_token");
});

Deno.test("malformed bearer token uses malformed_bearer_token", async () => {
  const request = makeRequest({
    headers: { Authorization: "Basic abc" },
  });
  const err = await assertRejects(
    () => assertBrowserSessionOnly(request, verifierReturning({ sub: "u" })),
    ApiAuthenticationError,
  );
  assertEquals(err.code, "malformed_bearer_token");
});

// -----------------------------------------------------------------------------
// Forged header / query / body are not authoritative
// -----------------------------------------------------------------------------

Deno.test("forged X-BTPM-Client-ID with no signed claim passes through", async () => {
  const request = makeRequest({
    headers: {
      Authorization: VALID_BEARER,
      "X-BTPM-Client-ID": "forged-client",
      "x-client-id": "forged-client",
      "x-client-info": "forged-info",
    },
  });
  await assertBrowserSessionOnly(
    request,
    verifierReturning({ sub: "u" }),
  );
});

Deno.test("forged header cannot override a signed client_id", async () => {
  const request = makeRequest({
    headers: {
      Authorization: VALID_BEARER,
      "X-BTPM-Client-ID": "",
      "x-client-id": "",
    },
  });
  const err = await assertRejects(
    () =>
      assertBrowserSessionOnly(
        request,
        verifierReturning({ sub: "u", client_id: "signed-external" }),
      ),
    ApiAuthenticationError,
  );
  assertEquals(err.code, "client_disabled");
});

Deno.test("query string client_id cannot create authority", async () => {
  const request = makeRequest({
    url: `${ENDPOINT_URL}?client_id=forged-in-query`,
  });
  // No signed client_id in claims → guard must accept.
  await assertBrowserSessionOnly(
    request,
    verifierReturning({ sub: "u" }),
  );
});

Deno.test("request body content is never read by the guard", async () => {
  const request = makeRequest({
    method: "POST",
    headers: {
      Authorization: VALID_BEARER,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: "forged-in-body" }),
  });
  await assertBrowserSessionOnly(
    request,
    verifierReturning({ sub: "u" }),
  );
  // Body must still be readable afterwards — proof the guard did not consume it.
  const consumed = await request.json();
  assertEquals(consumed.client_id, "forged-in-body");
});

// -----------------------------------------------------------------------------
// Endpoint static integration checks
// -----------------------------------------------------------------------------

function stripComments(source: string): string {
  // Remove /* ... */ block comments and // line comments.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const ENDPOINTS = [
  "supabase/functions/openai-test-connection/index.ts",
  "supabase/functions/azure-openai-test-connection/index.ts",
];

for (const endpointPath of ENDPOINTS) {
  Deno.test(`endpoint ${endpointPath} integrates the browser-only guard correctly`, async () => {
    const raw = await Deno.readTextFile(endpointPath);
    const src = stripComments(raw);

    // Required imports (checked in the raw source; strings only).
    if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
      throw new Error(`${endpointPath}: missing assertBrowserSessionOnly import`);
    }
    if (!raw.includes(`createSupabaseTokenVerifier`)) {
      throw new Error(`${endpointPath}: missing createSupabaseTokenVerifier import`);
    }
    if (!raw.includes(`toSafeErrorResponse`)) {
      throw new Error(`${endpointPath}: missing toSafeErrorResponse import`);
    }

    // Exactly one guard invocation.
    const guardCalls = src.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
    assertEquals(
      guardCalls.length,
      1,
      `${endpointPath}: expected exactly one assertBrowserSessionOnly call`,
    );

    // Locate positions in the comment-stripped executable source.
    const guardIdx = src.indexOf("assertBrowserSessionOnly(");
    const optionsIdx = src.indexOf('req.method === "OPTIONS"');
    const reqJsonIdx = src.indexOf("req.json(");
    const serviceRoleIdx = src.indexOf("SERVICE_ROLE_KEY");
    const evaluateAuthorityIdx = src.indexOf("evaluateAuthority(");
    const runtimeIdx = Math.max(
      src.indexOf("resolveTenantOpenAiRuntimeConfig("),
      src.indexOf("resolveTenantAzureOpenAiRuntimeConfig("),
    );

    if (
      guardIdx < 0 || optionsIdx < 0 || reqJsonIdx < 0 ||
      serviceRoleIdx < 0 || evaluateAuthorityIdx < 0 || runtimeIdx < 0
    ) {
      throw new Error(`${endpointPath}: expected anchor markers missing`);
    }

    if (guardIdx <= optionsIdx) {
      throw new Error(`${endpointPath}: guard must come after OPTIONS branch`);
    }
    if (guardIdx >= reqJsonIdx) {
      throw new Error(`${endpointPath}: guard must precede req.json()`);
    }
    // Service-role client is the second createClient(...) using SERVICE_ROLE_KEY.
    // The guard must appear before ANY reference to SERVICE_ROLE_KEY inside
    // the request handler body (guard vs. the first executable reference).
    // The module-level `const SERVICE_ROLE_KEY = Deno.env.get(...)` reference
    // sits above the handler, so we compare against the *handler-scoped*
    // occurrence: the createClient call passing SERVICE_ROLE_KEY.
    const serviceRoleClientIdx = src.indexOf(
      "createClient(SUPABASE_URL, SERVICE_ROLE_KEY",
    );
    if (serviceRoleClientIdx < 0 || guardIdx >= serviceRoleClientIdx) {
      throw new Error(
        `${endpointPath}: guard must precede service-role client construction`,
      );
    }
    if (guardIdx >= evaluateAuthorityIdx) {
      throw new Error(`${endpointPath}: guard must precede evaluateAuthority`);
    }
    if (guardIdx >= runtimeIdx) {
      throw new Error(
        `${endpointPath}: guard must precede integration runtime resolution`,
      );
    }

    // Forbidden authorities.
    if (/authenticateApiRequest\s*\(/.test(src)) {
      throw new Error(
        `${endpointPath}: must not call authenticateApiRequest`,
      );
    }
    for (
      const forgedHeader of [
        "X-BTPM-Client-ID",
        "x-btpm-client-id",
        "x-client-id",
      ]
    ) {
      if (
        new RegExp(
          `headers\\.get\\(\\s*["']${forgedHeader}["']`,
          "i",
        ).test(src)
      ) {
        throw new Error(
          `${endpointPath}: must not read forged client header ${forgedHeader}`,
        );
      }
    }
  });
}

Deno.test("only the two locked endpoints are covered by this suite", () => {
  assertEquals(ENDPOINTS.length, 2);
  assertEquals(
    ENDPOINTS[0],
    "supabase/functions/openai-test-connection/index.ts",
  );
  assertEquals(
    ENDPOINTS[1],
    "supabase/functions/azure-openai-test-connection/index.ts",
  );
});

// -----------------------------------------------------------------------------
// API-E.R4A-C1 — toSafeErrorResponse CORS preservation
// -----------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.test("toSafeErrorResponse without extra headers preserves prior behavior", async () => {
  const err = new ApiAuthenticationError("client_disabled");
  const res = toSafeErrorResponse(err);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  const body = await res.json();
  assertEquals(body, {
    error: { code: "client_disabled", message: "Client is not authorized." },
  });
});

Deno.test("toSafeErrorResponse retains supplied CORS headers", async () => {
  const err = new ApiAuthenticationError("client_disabled");
  const res = toSafeErrorResponse(err, CORS_HEADERS);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    res.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type",
  );
  assertEquals(res.headers.get("Content-Type"), "application/json");
  const body = await res.json();
  assertEquals(body.error.code, "client_disabled");
});

Deno.test("toSafeErrorResponse forces application/json even if overridden", () => {
  const err = new ApiAuthenticationError("invalid_token");
  const res = toSafeErrorResponse(err, {
    ...CORS_HEADERS,
    "Content-Type": "text/plain",
  });
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("toSafeErrorResponse never leaks internal cause on unknown errors", async () => {
  const secret = "bearer-abc.super-secret.claim-xyz";
  const res = toSafeErrorResponse(new Error(secret), CORS_HEADERS);
  assertEquals(res.status, 500);
  const text = await res.text();
  if (text.includes(secret)) {
    throw new Error("internal cause leaked");
  }
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(res.headers.get("Content-Type"), "application/json");
});

Deno.test("both endpoints call toSafeErrorResponse(guardError, corsHeaders)", async () => {
  for (const endpointPath of ENDPOINTS) {
    const raw = await Deno.readTextFile(endpointPath);
    const src = stripComments(raw);
    if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(src)) {
      throw new Error(
        `${endpointPath}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
      );
    }
    if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(src)) {
      throw new Error(
        `${endpointPath}: guard error path must not call the one-argument helper`,
      );
    }
  }
});

// -----------------------------------------------------------------------------
// API-E.R4B — Microsoft Graph and SharePoint connection-test endpoints
// -----------------------------------------------------------------------------

interface R4BEndpointDescriptor {
  path: string;
  runtimeResolvers: string[];
  providerAnchors: string[];
  extraOrderingAnchors?: string[];
}

const R4B_ENDPOINTS: R4BEndpointDescriptor[] = [
  {
    path: "supabase/functions/microsoft-graph-test-connection/index.ts",
    runtimeResolvers: ["resolveTenantMicrosoftGraphRuntimeConfig("],
    providerAnchors: [
      "acquireMicrosoftGraphToken(",
      "probeMicrosoftGraphApi(",
    ],
  },
  {
    path: "supabase/functions/sharepoint-test-connection/index.ts",
    runtimeResolvers: ["resolveTenantSharePointRuntimeConfig("],
    providerAnchors: [
      "resolveAndAcquireTenantMicrosoftGraph(",
    ],
    extraOrderingAnchors: ["sync_sharepoint_org_site_projection"],
  },
];

for (const desc of R4B_ENDPOINTS) {
  Deno.test(`R4B endpoint ${desc.path} integrates the browser-only guard correctly`, async () => {
    const raw = await Deno.readTextFile(desc.path);
    const src = stripComments(raw);

    // Required imports.
    if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
      throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
    }
    if (!raw.includes(`createSupabaseTokenVerifier`)) {
      throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
    }
    if (!raw.includes(`toSafeErrorResponse`)) {
      throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
    }

    // Exactly one guard invocation.
    const guardCalls = src.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
    assertEquals(
      guardCalls.length,
      1,
      `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
    );

    // Guard error path must call the two-argument helper, never the one-arg form.
    if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(src)) {
      throw new Error(
        `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
      );
    }
    if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(src)) {
      throw new Error(
        `${desc.path}: guard error path must not call the one-argument helper`,
      );
    }

    const guardIdx = src.indexOf("assertBrowserSessionOnly(");
    const optionsIdx = src.indexOf('req.method === "OPTIONS"');
    const callerClientIdx = src.indexOf("createClient(SUPABASE_URL, ANON_KEY");
    const getUserIdx = src.indexOf("callerClient.auth");
    const reqJsonIdx = src.indexOf("req.json(");
    const serviceRoleClientIdx = src.indexOf(
      "createClient(SUPABASE_URL, SERVICE_ROLE_KEY",
    );
    const evaluateAuthorityIdx = src.indexOf("evaluateAuthority(");
    const persistenceIdx = src.indexOf("recordTenantIntegrationTestResult(");

    if (
      guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
      getUserIdx < 0 || reqJsonIdx < 0 || serviceRoleClientIdx < 0 ||
      evaluateAuthorityIdx < 0 || persistenceIdx < 0
    ) {
      throw new Error(`${desc.path}: expected anchor markers missing`);
    }

    if (guardIdx <= optionsIdx) {
      throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
    }
    if (guardIdx <= callerClientIdx) {
      throw new Error(
        `${desc.path}: guard must come after caller-scoped anon client creation`,
      );
    }
    if (guardIdx >= getUserIdx) {
      throw new Error(`${desc.path}: guard must precede auth.getUser()`);
    }
    if (guardIdx >= reqJsonIdx) {
      throw new Error(`${desc.path}: guard must precede req.json()`);
    }
    if (guardIdx >= serviceRoleClientIdx) {
      throw new Error(
        `${desc.path}: guard must precede service-role client construction`,
      );
    }
    if (guardIdx >= evaluateAuthorityIdx) {
      throw new Error(`${desc.path}: guard must precede evaluateAuthority`);
    }
    for (const resolver of desc.runtimeResolvers) {
      const idx = src.indexOf(resolver);
      if (idx < 0 || guardIdx >= idx) {
        throw new Error(
          `${desc.path}: guard must precede runtime resolver ${resolver}`,
        );
      }
    }
    for (const anchor of desc.providerAnchors) {
      const idx = src.indexOf(anchor);
      if (idx < 0 || guardIdx >= idx) {
        throw new Error(
          `${desc.path}: guard must precede provider anchor ${anchor}`,
        );
      }
    }
    if (guardIdx >= persistenceIdx) {
      throw new Error(`${desc.path}: guard must precede persistence`);
    }
    for (const extra of desc.extraOrderingAnchors ?? []) {
      const idx = src.indexOf(extra);
      if (idx < 0 || guardIdx >= idx) {
        throw new Error(
          `${desc.path}: guard must precede ordering anchor ${extra}`,
        );
      }
    }

    // Forbidden authorities.
    if (/authenticateApiRequest\s*\(/.test(src)) {
      throw new Error(`${desc.path}: must not call authenticateApiRequest`);
    }
    for (
      const forgedHeader of [
        "X-BTPM-Client-ID",
        "x-btpm-client-id",
        "x-client-id",
      ]
    ) {
      if (
        new RegExp(
          `headers\\.get\\(\\s*["']${forgedHeader}["']`,
          "i",
        ).test(src)
      ) {
        throw new Error(
          `${desc.path}: must not read forged client header ${forgedHeader}`,
        );
      }
    }
  });
}

Deno.test("R4B descriptor set contains exactly the two Microsoft endpoints", () => {
  assertEquals(R4B_ENDPOINTS.length, 2);
  assertEquals(
    R4B_ENDPOINTS[0].path,
    "supabase/functions/microsoft-graph-test-connection/index.ts",
  );
  assertEquals(
    R4B_ENDPOINTS[1].path,
    "supabase/functions/sharepoint-test-connection/index.ts",
  );
});

// -----------------------------------------------------------------------------
// API-E.R4C — SharePoint operational endpoints
// -----------------------------------------------------------------------------

interface R4CEndpointDescriptor {
  path: string;
  runtimeResolvers: string[];
  microsoftTokenAnchors: string[];
  transportAnchors: string[];
  persistenceAnchors: string[];
}

const R4C_ENDPOINTS: R4CEndpointDescriptor[] = [
  {
    path: "supabase/functions/sharepoint-files/index.ts",
    runtimeResolvers: ["resolveTenantSharePointRuntimeConfig("],
    microsoftTokenAnchors: ["resolveAndAcquireTenantMicrosoftGraph("],
    transportAnchors: [
      "listSharePointDriveItemChildren(",
      "getSharePointDriveItemMetadata(",
    ],
    persistenceAnchors: [
      "createSharePointFolder(",
      "createSharePointUploadSession(",
      "deleteSharePointDriveItem(",
    ],
  },
  {
    path: "supabase/functions/sharepoint-validate/index.ts",
    runtimeResolvers: ["resolveTenantSharePointRuntimeConfig("],
    microsoftTokenAnchors: ["resolveAndAcquireTenantMicrosoftGraph("],
    transportAnchors: [
      "validateOrgSiteAgainstRuntime(",
      "validateWorkspaceBindingAgainstRuntime(",
      "diagnoseWorkspaceBindingAgainstRuntime(",
      "validateProjectBindingAgainstRuntime(",
    ],
    persistenceAnchors: ["apply_org_site_validation"],
  },
];

for (const desc of R4C_ENDPOINTS) {
  Deno.test(`R4C endpoint ${desc.path} integrates the browser-only guard correctly`, async () => {
    const raw = await Deno.readTextFile(desc.path);
    const src = stripComments(raw);

    if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
      throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
    }
    if (!raw.includes(`createSupabaseTokenVerifier`)) {
      throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
    }
    if (!raw.includes(`toSafeErrorResponse`)) {
      throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
    }

    const guardCalls = src.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
    assertEquals(
      guardCalls.length,
      1,
      `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
    );

    if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(src)) {
      throw new Error(
        `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
      );
    }
    if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(src)) {
      throw new Error(
        `${desc.path}: guard error path must not call the one-argument helper`,
      );
    }

    const guardIdx = src.indexOf("assertBrowserSessionOnly(");
    const optionsIdx = src.indexOf('req.method === "OPTIONS"');
    const callerClientIdx = src.indexOf("createClient(SUPABASE_URL, ANON_KEY");
    const getUserIdx = src.indexOf("callerClient.auth");
    const reqJsonIdx = src.indexOf("req.json(");
    const serviceRoleClientIdx = src.indexOf(
      "createClient(SUPABASE_URL, SERVICE_ROLE)",
    );
    const serviceRoleClientIdx2 = src.indexOf(
      "createClient(SUPABASE_URL, SERVICE_ROLE,",
    );
    const serviceRoleIdx = serviceRoleClientIdx >= 0
      ? serviceRoleClientIdx
      : serviceRoleClientIdx2;
    // Only DB access reachable from the handler counts — helpers defined
    // above the handler are unreachable until the guard has already run.
    const firstFromIdx = src.indexOf(".from(", callerClientIdx);
    const firstRpcIdx = src.indexOf(".rpc(", callerClientIdx);
    const firstDbIdx = [firstFromIdx, firstRpcIdx]
      .filter((v) => v >= 0)
      .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

    if (
      guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
      getUserIdx < 0 || reqJsonIdx < 0 || serviceRoleIdx < 0 ||
      firstDbIdx === Number.MAX_SAFE_INTEGER
    ) {
      throw new Error(`${desc.path}: expected anchor markers missing`);
    }

    if (guardIdx <= optionsIdx) {
      throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
    }
    if (guardIdx <= callerClientIdx) {
      throw new Error(
        `${desc.path}: guard must come after caller-scoped anon client creation`,
      );
    }
    if (guardIdx >= getUserIdx) {
      throw new Error(`${desc.path}: guard must precede auth.getUser()`);
    }
    if (guardIdx >= reqJsonIdx) {
      throw new Error(`${desc.path}: guard must precede req.json()`);
    }
    if (guardIdx >= serviceRoleIdx) {
      throw new Error(
        `${desc.path}: guard must precede service-role client construction`,
      );
    }
    if (guardIdx >= firstDbIdx) {
      throw new Error(
        `${desc.path}: guard must precede first database query or RPC`,
      );
    }
    for (const resolver of desc.runtimeResolvers) {
      const idx = src.indexOf(resolver);
      if (idx < 0 || guardIdx >= idx) {
        throw new Error(
          `${desc.path}: guard must precede runtime resolver ${resolver}`,
        );
      }
    }
    for (const anchor of desc.microsoftTokenAnchors) {
      const idx = src.indexOf(anchor);
      if (idx < 0 || guardIdx >= idx) {
        throw new Error(
          `${desc.path}: guard must precede Microsoft token acquisition ${anchor}`,
        );
      }
    }
    for (const anchor of desc.transportAnchors) {
      const idx = src.indexOf(anchor);
      if (idx < 0 || guardIdx >= idx) {
        throw new Error(
          `${desc.path}: guard must precede SharePoint/Graph transport ${anchor}`,
        );
      }
    }
    for (const anchor of desc.persistenceAnchors) {
      const idx = src.indexOf(anchor);
      if (idx < 0 || guardIdx >= idx) {
        throw new Error(
          `${desc.path}: guard must precede persistence anchor ${anchor}`,
        );
      }
    }

    if (/authenticateApiRequest\s*\(/.test(src)) {
      throw new Error(`${desc.path}: must not call authenticateApiRequest`);
    }
    for (
      const forgedHeader of [
        "X-BTPM-Client-ID",
        "x-btpm-client-id",
        "x-client-id",
      ]
    ) {
      if (
        new RegExp(
          `headers\\.get\\(\\s*["']${forgedHeader}["']`,
          "i",
        ).test(src)
      ) {
        throw new Error(
          `${desc.path}: must not read forged client header ${forgedHeader}`,
        );
      }
    }
  });
}

Deno.test("R4C descriptor set contains exactly the two SharePoint operational endpoints", () => {
  assertEquals(R4C_ENDPOINTS.length, 2);
  assertEquals(
    R4C_ENDPOINTS[0].path,
    "supabase/functions/sharepoint-files/index.ts",
  );
  assertEquals(
    R4C_ENDPOINTS[1].path,
    "supabase/functions/sharepoint-validate/index.ts",
  );
});

// -----------------------------------------------------------------------------
// API-E.R4D — Decision Case SharePoint evidence endpoints
// -----------------------------------------------------------------------------

interface R4DEndpointDescriptor {
  path: string;
  projectAuthorityRpc: string;
  runtimeResolvers: string[];
  microsoftTokenAnchors: string[];
  transportAnchors: string[];
  extraPreGuardAnchors?: string[];
}

const R4D_ENDPOINTS: R4DEndpointDescriptor[] = [
  {
    path:
      "supabase/functions/browse-governance-decision-sharepoint-files/index.ts",
    projectAuthorityRpc: "_gov_assert_project_read",
    runtimeResolvers: [
      "resolveTenantSharePointRuntimeConfig(",
      "resolveSharePointProjectRoot(",
    ],
    microsoftTokenAnchors: ["resolveAndAcquireTenantMicrosoftGraph("],
    transportAnchors: [
      "getSharePointDriveItemMetadata(",
      "listSharePointDriveItemChildren(",
      "buildSharePointProjectBreadcrumbs(",
    ],
  },
  {
    path:
      "supabase/functions/select-governance-decision-sharepoint-evidence-files/index.ts",
    projectAuthorityRpc: "_gov_assert_project_write",
    runtimeResolvers: [
      "resolveTenantSharePointRuntimeConfig(",
      "resolveSharePointProjectRoot(",
    ],
    microsoftTokenAnchors: ["resolveAndAcquireTenantMicrosoftGraph("],
    transportAnchors: ["getSharePointDriveItemMetadata("],
    extraPreGuardAnchors: [
      "governance_record_evidence_files",
      ".insert(",
      "log_activity_event",
    ],
  },
];

for (const desc of R4D_ENDPOINTS) {
  Deno.test(
    `R4D endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = src.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(src)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(src)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      // Guard must use the existing caller client.
      if (
        !/createSupabaseTokenVerifier\(\s*caller\s*\)/.test(src)
      ) {
        throw new Error(
          `${desc.path}: guard must use the existing caller client`,
        );
      }

      const guardIdx = src.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = src.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = src.indexOf(
        "createClient(SUPABASE_URL, ANON_KEY",
      );
      const getUserIdx = src.indexOf("caller.auth.getUser(");
      const reqJsonIdx = src.indexOf("req.json(");
      const serviceRoleClientIdx = src.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE)",
      );
      const serviceRoleClientIdx2 = src.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE,",
      );
      const serviceRoleIdx = serviceRoleClientIdx >= 0
        ? serviceRoleClientIdx
        : serviceRoleClientIdx2;
      const firstFromIdx = src.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = src.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        getUserIdx < 0 || reqJsonIdx < 0 || serviceRoleIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped anon client creation`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(`${desc.path}: guard must precede auth.getUser()`);
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      const authorityIdx = src.indexOf(desc.projectAuthorityRpc);
      if (authorityIdx < 0 || guardIdx >= authorityIdx) {
        throw new Error(
          `${desc.path}: guard must precede project authority RPC ${desc.projectAuthorityRpc}`,
        );
      }

      for (const resolver of desc.runtimeResolvers) {
        const idx = src.indexOf(resolver);
        if (idx < 0 || guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede runtime resolver ${resolver}`,
          );
        }
      }
      for (const anchor of desc.microsoftTokenAnchors) {
        const idx = src.indexOf(anchor);
        if (idx < 0 || guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede Microsoft token acquisition ${anchor}`,
          );
        }
      }
      for (const anchor of desc.transportAnchors) {
        const idx = src.indexOf(anchor);
        if (idx < 0 || guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede SharePoint/Graph transport ${anchor}`,
          );
        }
      }
      for (const anchor of desc.extraPreGuardAnchors ?? []) {
        const idx = src.indexOf(anchor);
        if (idx < 0 || guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede persistence anchor ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(src)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(src)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
    },
  );
}

Deno.test(
  "R4D descriptor set contains exactly the two Decision Case SharePoint evidence endpoints",
  () => {
    assertEquals(R4D_ENDPOINTS.length, 2);
    assertEquals(
      R4D_ENDPOINTS[0].path,
      "supabase/functions/browse-governance-decision-sharepoint-files/index.ts",
    );
    assertEquals(
      R4D_ENDPOINTS[1].path,
      "supabase/functions/select-governance-decision-sharepoint-evidence-files/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4E — Decision Case document generators
// -----------------------------------------------------------------------------

interface R4EEndpointDescriptor {
  path: string;
  mapper: string;
  builder: string;
}

const R4E_ENDPOINTS: R4EEndpointDescriptor[] = [
  {
    path: "supabase/functions/generate-decision-case-word-brief/index.ts",
    mapper: "mapDecisionCaseToBriefData(",
    builder: "buildDecisionBriefDocxBuffer(",
  },
  {
    path: "supabase/functions/generate-decision-case-ppt-onepager/index.ts",
    mapper: "mapDecisionCaseToOnepagerData(",
    builder: "buildDecisionOnepagerBuffer(",
  },
];

for (const desc of R4E_ENDPOINTS) {
  Deno.test(
    `R4E endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      // Isolate the handler body starting at Deno.serve.
      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      // Required imports.
      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (
        !/createSupabaseTokenVerifier\(\s*supabase\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(supabase)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SUPABASE_ANON_KEY",
      );
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE)",
      );
      const getUserIdx = handler.indexOf("supabase.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      const authorityIdx = handler.indexOf("has_project_pm_authority");
      const mapperIdx = handler.indexOf(desc.mapper);
      const builderIdx = handler.indexOf(desc.builder);
      const publishSessionIdx = handler.indexOf(
        "createTenantSharePointPublishSession(",
      );
      const publishTargetIdx = handler.indexOf(
        "resolveProjectDocumentPublishTarget(",
      );
      const publishBytesIdx = handler.indexOf(
        "publishGeneratedDocumentBytes(",
      );
      const auditIdx = handler.indexOf("record_generated_decision_case_document");

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        serviceRoleIdx < 0 || getUserIdx < 0 || reqJsonIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER || authorityIdx < 0 ||
        mapperIdx < 0 || builderIdx < 0 || publishSessionIdx < 0 ||
        publishTargetIdx < 0 || publishBytesIdx < 0 || auditIdx < 0
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped anon client creation`,
        );
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(`${desc.path}: guard must precede auth.getUser()`);
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }
      if (guardIdx >= authorityIdx) {
        throw new Error(
          `${desc.path}: guard must precede has_project_pm_authority`,
        );
      }
      if (guardIdx >= mapperIdx) {
        throw new Error(
          `${desc.path}: guard must precede Decision Case data mapper ${desc.mapper}`,
        );
      }
      if (guardIdx >= builderIdx) {
        throw new Error(
          `${desc.path}: guard must precede document builder ${desc.builder}`,
        );
      }
      if (guardIdx >= publishSessionIdx) {
        throw new Error(
          `${desc.path}: guard must precede createTenantSharePointPublishSession`,
        );
      }
      if (guardIdx >= publishTargetIdx) {
        throw new Error(
          `${desc.path}: guard must precede resolveProjectDocumentPublishTarget`,
        );
      }
      if (guardIdx >= publishBytesIdx) {
        throw new Error(
          `${desc.path}: guard must precede publishGeneratedDocumentBytes`,
        );
      }
      if (guardIdx >= auditIdx) {
        throw new Error(
          `${desc.path}: guard must precede record_generated_decision_case_document`,
        );
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4E descriptor set contains exactly the two Decision Case document generators",
  () => {
    assertEquals(R4E_ENDPOINTS.length, 2);
    assertEquals(
      R4E_ENDPOINTS[0].path,
      "supabase/functions/generate-decision-case-word-brief/index.ts",
    );
    assertEquals(
      R4E_ENDPOINTS[1].path,
      "supabase/functions/generate-decision-case-ppt-onepager/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4F — Decision Case data-package generators
// -----------------------------------------------------------------------------

interface R4FEndpointDescriptor {
  path: string;
  extraPreGuardAnchors: string[];
}

const R4F_ENDPOINTS: R4FEndpointDescriptor[] = [
  {
    path: "supabase/functions/generate-decision-case-data-package/index.ts",
    extraPreGuardAnchors: ["btpm_decrypt", "stableStringify(", "sha256Hex("],
  },
  {
    path: "supabase/functions/generate-decision-case-data-package-bundle/index.ts",
    extraPreGuardAnchors: [
      "resolveAndAcquireTenantMicrosoftGraph(",
      "downloadMicrosoftGraphDriveItemBytes(",
      "zipSync(",
      "storage.from(",
      ".upload(",
      ".remove(",
    ],
  },
];

for (const desc of R4F_ENDPOINTS) {
  Deno.test(
    `R4F endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*userClient\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(userClient)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const nonPostIdx = handler.indexOf('req.method !== "POST"');
      const callerClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SUPABASE_ANON_KEY",
      );
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE)",
      );
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      const authorityIdx = handler.indexOf("has_project_pm_authority");
      const pkgTableIdx = handler.indexOf(
        "governance_record_copilot_data_packages",
      );
      const firstInsertIdx = handler.indexOf(".insert(");
      const activityIdx = handler.indexOf("log_activity_event");

      if (
        guardIdx < 0 || optionsIdx < 0 || nonPostIdx < 0 ||
        callerClientIdx < 0 || serviceRoleIdx < 0 || getUserIdx < 0 ||
        reqJsonIdx < 0 || firstDbIdx === Number.MAX_SAFE_INTEGER ||
        authorityIdx < 0 || pkgTableIdx < 0 || firstInsertIdx < 0 ||
        activityIdx < 0
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= nonPostIdx) {
        throw new Error(`${desc.path}: guard must come after non-POST check`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped userClient creation`,
        );
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(
          `${desc.path}: guard must precede userClient.auth.getUser()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }
      if (guardIdx >= authorityIdx) {
        throw new Error(
          `${desc.path}: guard must precede has_project_pm_authority`,
        );
      }
      if (guardIdx >= pkgTableIdx) {
        throw new Error(
          `${desc.path}: guard must precede governance_record_copilot_data_packages access`,
        );
      }
      if (guardIdx >= firstInsertIdx) {
        throw new Error(`${desc.path}: guard must precede first .insert(`);
      }
      if (guardIdx >= activityIdx) {
        throw new Error(`${desc.path}: guard must precede log_activity_event`);
      }

      for (const anchor of desc.extraPreGuardAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4F descriptor set contains exactly the two Decision Case data-package generators",
  () => {
    assertEquals(R4F_ENDPOINTS.length, 2);
    assertEquals(
      R4F_ENDPOINTS[0].path,
      "supabase/functions/generate-decision-case-data-package/index.ts",
    );
    assertEquals(
      R4F_ENDPOINTS[1].path,
      "supabase/functions/generate-decision-case-data-package-bundle/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4G — Decision Case AI generation and polling
// -----------------------------------------------------------------------------

interface R4GEndpointDescriptor {
  path: string;
  aiAnchors: string[];
}

const R4G_ENDPOINTS: R4GEndpointDescriptor[] = [
  {
    path: "supabase/functions/generate-decision-case-ai-brief/index.ts",
    aiAnchors: [
      "resolveTenantAiTextRuntime(",
      "enqueueTenantAiResponse(",
      "resolveAndAcquireTenantMicrosoftGraph(",
      "downloadMicrosoftGraphDriveItemBytes(",
    ],
  },
  {
    path: "supabase/functions/poll-decision-case-ai-brief/index.ts",
    aiAnchors: [
      "resolveTenantAiTextRuntimeForProvider(",
      "getTenantAiResponseStatus(",
    ],
  },
];

for (const desc of R4G_ENDPOINTS) {
  Deno.test(
    `R4G endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*userClient\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(userClient)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const nonPostIdx = handler.indexOf('req.method !== "POST"');
      const callerClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SUPABASE_ANON_KEY",
      );
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE)",
      );
      const serviceRoleIdx2 = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE,",
      );
      const serviceRoleClientIdx = serviceRoleIdx >= 0
        ? serviceRoleIdx
        : serviceRoleIdx2;
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      const authorityIdx = handler.indexOf("has_project_pm_authority");
      const firstInsertIdx = handler.indexOf(".insert(");
      const firstUpdateIdx = handler.indexOf(".update(");
      const firstMutationIdx = [firstInsertIdx, firstUpdateIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || nonPostIdx < 0 ||
        callerClientIdx < 0 || serviceRoleClientIdx < 0 || getUserIdx < 0 ||
        reqJsonIdx < 0 || firstDbIdx === Number.MAX_SAFE_INTEGER ||
        authorityIdx < 0 || firstMutationIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= nonPostIdx) {
        throw new Error(`${desc.path}: guard must come after non-POST check`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped userClient creation`,
        );
      }
      if (guardIdx >= serviceRoleClientIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(
          `${desc.path}: guard must precede userClient.auth.getUser()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }
      if (guardIdx >= authorityIdx) {
        throw new Error(
          `${desc.path}: guard must precede has_project_pm_authority`,
        );
      }
      if (guardIdx >= firstMutationIdx) {
        throw new Error(`${desc.path}: guard must precede first persistence mutation`);
      }

      for (const anchor of desc.aiAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\.get\\(\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4G descriptor set contains exactly the two Decision Case AI generation/polling endpoints",
  () => {
    assertEquals(R4G_ENDPOINTS.length, 2);
    assertEquals(
      R4G_ENDPOINTS[0].path,
      "supabase/functions/generate-decision-case-ai-brief/index.ts",
    );
    assertEquals(
      R4G_ENDPOINTS[1].path,
      "supabase/functions/poll-decision-case-ai-brief/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4H — Roadmap Story AI endpoints
// -----------------------------------------------------------------------------

interface R4HEndpointDescriptor {
  path: string;
  aiAnchors: string[];
  persistenceAnchors: string[];
}

const R4H_ENDPOINTS: R4HEndpointDescriptor[] = [
  {
    path: "supabase/functions/generate-roadmap-story/index.ts",
    aiAnchors: [
      "resolveTenantAiTextRuntime(",
      "enqueueTenantAiResponse(",
      "resolveAndAcquireTenantMicrosoftGraph(",
    ],
    persistenceAnchors: [
      "start_roadmap_story_generation_run",
      "set_roadmap_story_run_response_id",
      "record_roadmap_story_run_files",
    ],
  },
  {
    path: "supabase/functions/poll-roadmap-story/index.ts",
    aiAnchors: [
      "resolveTenantAiTextRuntimeForProvider(",
      "getTenantAiResponseStatus(",
    ],
    persistenceAnchors: [
      "complete_roadmap_story_generation_run",
      "fail_roadmap_story_generation_run",
    ],
  },
  {
    path: "supabase/functions/generate-roadmap-story-presentation/index.ts",
    aiAnchors: [
      "resolveTenantAiTextRuntime(",
      "enqueueTenantAiResponse(",
    ],
    persistenceAnchors: [
      "start_roadmap_story_presentation_run",
      "set_roadmap_story_presentation_run_response_id",
    ],
  },
  {
    path: "supabase/functions/poll-roadmap-story-presentation/index.ts",
    aiAnchors: [
      "resolveTenantAiTextRuntimeForProvider(",
      "getTenantAiResponseStatus(",
    ],
    persistenceAnchors: [
      "complete_roadmap_story_presentation_run",
      "fail_roadmap_story_presentation_run",
    ],
  },
];

for (const desc of R4H_ENDPOINTS) {
  Deno.test(
    `R4H endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*userClient\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(userClient)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const nonPostIdx = handler.indexOf('req.method !== "POST"');
      const callerClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SUPABASE_ANON_KEY",
      );
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE)",
      );
      const serviceRoleIdx2 = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE,",
      );
      const serviceRoleClientIdx = serviceRoleIdx >= 0
        ? serviceRoleIdx
        : serviceRoleIdx2;
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      const firstInsertIdx = handler.indexOf(".insert(");
      const firstUpdateIdx = handler.indexOf(".update(");
      const firstMutationIdx = [firstInsertIdx, firstUpdateIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      const required = [
        guardIdx,
        optionsIdx,
        nonPostIdx,
        callerClientIdx,
        getUserIdx,
        reqJsonIdx,
        firstDbIdx,
      ];
      if (desc.path.includes("generate")) {
        if (serviceRoleClientIdx < 0) {
          throw new Error(
            `${desc.path}: expected service-role client construction`,
          );
        }
        required.push(serviceRoleClientIdx);
      }
      if (
        required.some((v) => v < 0) ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= nonPostIdx) {
        throw new Error(`${desc.path}: guard must come after non-POST check`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped userClient creation`,
        );
      }
      if (desc.path.includes("generate")) {
        if (guardIdx >= serviceRoleClientIdx) {
          throw new Error(
            `${desc.path}: guard must precede service-role client construction`,
          );
        }
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(
          `${desc.path}: guard must precede userClient.auth.getUser()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }
      if (
        firstMutationIdx !== Number.MAX_SAFE_INTEGER &&
        guardIdx >= firstMutationIdx
      ) {
        throw new Error(
          `${desc.path}: guard must precede first persistence mutation`,
        );
      }

      for (const anchor of desc.aiAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      for (const anchor of desc.persistenceAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede persistence anchor ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4H descriptor set contains exactly the four Roadmap Story AI endpoints",
  () => {
    assertEquals(R4H_ENDPOINTS.length, 4);
    assertEquals(
      R4H_ENDPOINTS[0].path,
      "supabase/functions/generate-roadmap-story/index.ts",
    );
    assertEquals(
      R4H_ENDPOINTS[1].path,
      "supabase/functions/poll-roadmap-story/index.ts",
    );
    assertEquals(
      R4H_ENDPOINTS[2].path,
      "supabase/functions/generate-roadmap-story-presentation/index.ts",
    );
    assertEquals(
      R4H_ENDPOINTS[3].path,
      "supabase/functions/poll-roadmap-story-presentation/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4I — Project and Roadmap document publishers
// -----------------------------------------------------------------------------

interface R4IEndpointDescriptor {
  path: string;
  preGuardAnchors: string[];
}

const R4I_ENDPOINTS: R4IEndpointDescriptor[] = [
  {
    path: "supabase/functions/generate-project-charter/index.ts",
    preGuardAnchors: [
      "mapProjectToCharterData(",
      "buildCharterDocxBuffer(",
      "has_project_pm_authority",
      "createTenantSharePointPublishSession(",
      "resolveProjectDocumentPublishTarget(",
      "publishGeneratedDocumentBytes(",
      "record_generated_operational_document",
    ],
  },
  {
    path: "supabase/functions/generate-project-closure-report/index.ts",
    preGuardAnchors: [
      "mapProjectToClosureReportData(",
      "buildClosureReportDocxBuffer(",
      "has_project_pm_authority",
      "createTenantSharePointPublishSession(",
      "resolveProjectDocumentPublishTarget(",
      "publishGeneratedDocumentBytes(",
      "record_generated_operational_document",
    ],
  },
  {
    path: "supabase/functions/generate-project-status-deck/index.ts",
    preGuardAnchors: [
      "mapProjectToStatusDeckData(",
      "buildStatusDeckBuffer(",
      "has_project_pm_authority",
      "createTenantSharePointPublishSession(",
      "resolveProjectDocumentPublishTarget(",
      "publishGeneratedDocumentBytes(",
      "record_generated_operational_document",
    ],
  },
  {
    path: "supabase/functions/generate-roadmap-status-deck/index.ts",
    preGuardAnchors: [
      "mapRoadmapDeckData(",
      "buildRoadmapDeckBuffer(",
      "is_active_user",
      "has_project_access",
      "createTenantSharePointPublishSession(",
      "resolveDefaultSiteDocumentPublishTarget(",
      "resolveWorkspaceDocumentPublishTarget(",
      "publishGeneratedDocumentBytes(",
      "record_generated_roadmap_document",
    ],
  },
];

for (const desc of R4I_ENDPOINTS) {
  Deno.test(
    `R4I endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*supabase\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(supabase)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SUPABASE_ANON_KEY",
      );
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE)",
      );
      const getUserIdx = handler.indexOf("supabase.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        serviceRoleIdx < 0 || getUserIdx < 0 || reqJsonIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped supabase client creation`,
        );
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(`${desc.path}: guard must precede supabase.auth.getUser()`);
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      for (const anchor of desc.preGuardAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4I descriptor set contains exactly the four Project and Roadmap document publishers",
  () => {
    assertEquals(R4I_ENDPOINTS.length, 4);
    assertEquals(
      R4I_ENDPOINTS[0].path,
      "supabase/functions/generate-project-charter/index.ts",
    );
    assertEquals(
      R4I_ENDPOINTS[1].path,
      "supabase/functions/generate-project-closure-report/index.ts",
    );
    assertEquals(
      R4I_ENDPOINTS[2].path,
      "supabase/functions/generate-project-status-deck/index.ts",
    );
    assertEquals(
      R4I_ENDPOINTS[3].path,
      "supabase/functions/generate-roadmap-status-deck/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4J — Document storage and publishing endpoints
// -----------------------------------------------------------------------------

interface R4JEndpointDescriptor {
  path: string;
  callerClientVar: string;
  preGuardAnchors: string[];
}

const R4J_ENDPOINTS: R4JEndpointDescriptor[] = [
  {
    path: "supabase/functions/create-project-lessons-learned-document/index.ts",
    callerClientVar: "supabase",
    preGuardAnchors: [
      "has_project_pm_authority",
      "get_decrypted_project",
      "sharepoint_project_bindings",
      "createTenantSharePointPublishSession(",
      "resolveProjectDocumentPublishTarget(",
      "getSharePointChildItem(",
      "publishGeneratedDocumentBytes(",
      "upsertMetadata(",
    ],
  },
  {
    path: "supabase/functions/refresh-project-lessons-learned-document-metadata/index.ts",
    callerClientVar: "supabase",
    preGuardAnchors: [
      "has_project_pm_authority",
      "get_decrypted_project_lessons_learned_document",
      "sharepoint_project_bindings",
      "createTenantSharePointPublishSession(",
      "resolveProjectDocumentPublishTarget(",
      "getSharePointDriveItemMetadata(",
      "upsertMetadata(",
    ],
  },
  {
    path: "supabase/functions/get-decision-case-data-package-bundle-download-url/index.ts",
    callerClientVar: "userClient",
    preGuardAnchors: [
      "governance_record_copilot_data_packages",
      "governance_records",
      "has_project_access",
      "btpm_decrypt",
      "createSignedUrl",
      ".update(",
    ],
  },
  {
    path: "supabase/functions/publish-roadmap-story-presentation/index.ts",
    callerClientVar: "userClient",
    preGuardAnchors: [
      "get_roadmap_story_pack_config",
      "get_latest_roadmap_story_presentation_blueprint",
      "publish_roadmap_story_presentation_version",
    ],
  },
];

for (const desc of R4J_ENDPOINTS) {
  Deno.test(
    `R4J endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (
        !new RegExp(
          `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
        ).test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard must use the existing caller client ${desc.callerClientVar}`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SUPABASE_ANON_KEY",
      );
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE)",
      );
      const serviceRoleIdx2 = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_ROLE,",
      );
      const serviceRoleClientIdx = serviceRoleIdx >= 0
        ? serviceRoleIdx
        : serviceRoleIdx2;
      const getUserIdx = handler.indexOf(
        `${desc.callerClientVar}.auth.getUser(`,
      );
      const reqJsonIdx = handler.indexOf("req.json(");
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      const firstInsertIdx = handler.indexOf(".insert(");
      const firstUpdateIdx = handler.indexOf(".update(");
      const firstMutationIdx = [firstInsertIdx, firstUpdateIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        getUserIdx < 0 || reqJsonIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped ${desc.callerClientVar} client creation`,
        );
      }
      if (serviceRoleClientIdx >= 0 && guardIdx >= serviceRoleClientIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(
          `${desc.path}: guard must precede ${desc.callerClientVar}.auth.getUser()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }
      if (
        firstMutationIdx !== Number.MAX_SAFE_INTEGER &&
        guardIdx >= firstMutationIdx
      ) {
        throw new Error(
          `${desc.path}: guard must precede first persistence mutation`,
        );
      }

      for (const anchor of desc.preGuardAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4J descriptor set contains exactly the four document storage and publishing endpoints",
  () => {
    assertEquals(R4J_ENDPOINTS.length, 4);
    assertEquals(
      R4J_ENDPOINTS[0].path,
      "supabase/functions/create-project-lessons-learned-document/index.ts",
    );
    assertEquals(
      R4J_ENDPOINTS[1].path,
      "supabase/functions/refresh-project-lessons-learned-document-metadata/index.ts",
    );
    assertEquals(
      R4J_ENDPOINTS[2].path,
      "supabase/functions/get-decision-case-data-package-bundle-download-url/index.ts",
    );
    assertEquals(
      R4J_ENDPOINTS[3].path,
      "supabase/functions/publish-roadmap-story-presentation/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4K — BTPM Import endpoints
// -----------------------------------------------------------------------------

interface R4KEndpointDescriptor {
  path: string;
  preGuardAnchors: string[];
}

const R4K_ENDPOINTS: R4KEndpointDescriptor[] = [
  {
    path: "supabase/functions/btpm-import-dry-run/index.ts",
    preGuardAnchors: [
      "userClient.auth.getClaims(",
      "createClient(SUPABASE_URL, SERVICE_KEY",
      "req.json(",
      "profiles",
      "get_my_active_context",
      "is_org_admin",
      "workspaces",
      "runContainmentValidation(",
      "sha256Hex(",
      "btpm_import_batches",
    ],
  },
  {
    path: "supabase/functions/btpm-import-commit/index.ts",
    preGuardAnchors: [
      "userClient.auth.getClaims(",
      "createClient(SUPABASE_URL, SERVICE_KEY",
      "req.json(",
      "profiles",
      "get_my_active_context",
      "is_org_admin",
      "workspaces",
      "btpm_import_batches",
      "runContainmentValidation(",
      "sha256Hex(",
      "commit_btpm_import_v1_core",
    ],
  },
];

for (const desc of R4K_ENDPOINTS) {
  Deno.test(
    `R4K endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*userClient\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(userClient)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, ANON_KEY",
      );
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_KEY",
      );
      const getClaimsIdx = handler.indexOf("userClient.auth.getClaims(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        serviceRoleIdx < 0 || getClaimsIdx < 0 || reqJsonIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped userClient creation`,
        );
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= getClaimsIdx) {
        throw new Error(
          `${desc.path}: guard must precede userClient.auth.getClaims()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      for (const anchor of desc.preGuardAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\.get\\(\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4K descriptor set contains exactly the two BTPM Import endpoints",
  () => {
    assertEquals(R4K_ENDPOINTS.length, 2);
    assertEquals(
      R4K_ENDPOINTS[0].path,
      "supabase/functions/btpm-import-dry-run/index.ts",
    );
    assertEquals(
      R4K_ENDPOINTS[1].path,
      "supabase/functions/btpm-import-commit/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4L — MuleSoft KPI Read endpoints
// -----------------------------------------------------------------------------

interface R4LEndpointDescriptor {
  path: string;
}

const R4L_ENDPOINTS: R4LEndpointDescriptor[] = [
  {
    path: "supabase/functions/read-kpi-app-catalog/index.ts",
  },
  {
    path: "supabase/functions/read-kpi-app-dimensions/index.ts",
  },
];

for (const desc of R4L_ENDPOINTS) {
  Deno.test(
    `R4L endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*caller\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(caller)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(supabaseUrl, anonKey",
      );
      const getUserIdx = handler.indexOf("caller.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const serviceRoleClientIdx = handler.indexOf(
        "createClient(supabaseUrl, serviceRoleKey",
      );
      const evaluateAuthorityIdx = handler.indexOf("evaluateAuthority(");
      const runtimeIdx = handler.indexOf(
        "resolveTenantMulesoftKpiRuntimeConfig(",
      );
      const fetchIdx = handler.indexOf("fetch(");

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        getUserIdx < 0 || reqJsonIdx < 0 || serviceRoleClientIdx < 0 ||
        evaluateAuthorityIdx < 0 || runtimeIdx < 0 || fetchIdx < 0
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped anon client creation`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(`${desc.path}: guard must precede caller.auth.getUser()`);
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= serviceRoleClientIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= evaluateAuthorityIdx) {
        throw new Error(`${desc.path}: guard must precede evaluateAuthority`);
      }
      if (guardIdx >= runtimeIdx) {
        throw new Error(
          `${desc.path}: guard must precede MuleSoft KPI runtime resolution`,
        );
      }
      if (guardIdx >= fetchIdx) {
        throw new Error(
          `${desc.path}: guard must precede external fetch`,
        );
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4L descriptor set contains exactly the two MuleSoft KPI Read endpoints",
  () => {
    assertEquals(R4L_ENDPOINTS.length, 2);
    assertEquals(
      R4L_ENDPOINTS[0].path,
      "supabase/functions/read-kpi-app-catalog/index.ts",
    );
    assertEquals(
      R4L_ENDPOINTS[1].path,
      "supabase/functions/read-kpi-app-dimensions/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4M — Organization User Administration
// -----------------------------------------------------------------------------

interface R4MEndpointDescriptor {
  path: string;
  preGuardAnchors: string[];
}

const R4M_ENDPOINTS: R4MEndpointDescriptor[] = [
  {
    path: "supabase/functions/admin-users/index.ts",
    preGuardAnchors: [
      "callerClient.auth.getUser(",
      "createClient(supabaseUrl, serviceRoleKey",
      "req.json(",
      "is_org_admin",
      "adminClient.auth.admin.getUserById(",
      "ensureOrgProfile(",
      "admin_add_workspace_access",
      "admin_set_org_admin",
      "listOrganizationUsers(",
      "listOrganizationInvitations(",
      "getOrganizationUserDetail(",
    ],
  },
];


for (const desc of R4M_ENDPOINTS) {
  Deno.test(
    `R4M endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*callerClient\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(callerClient)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(supabaseUrl, anonKey",
      );
      const getUserIdx = handler.indexOf("callerClient.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const serviceRoleClientIdx = handler.indexOf(
        "createClient(supabaseUrl, serviceRoleKey",
      );
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]

        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        getUserIdx < 0 || reqJsonIdx < 0 || serviceRoleClientIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped callerClient creation`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(
          `${desc.path}: guard must precede callerClient.auth.getUser()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= serviceRoleClientIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      for (const anchor of desc.preGuardAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4M descriptor set contains exactly the Organization User Administration endpoint",
  () => {
    assertEquals(R4M_ENDPOINTS.length, 1);
    assertEquals(
      R4M_ENDPOINTS[0].path,
      "supabase/functions/admin-users/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4N — KPI App Payload Builder
// -----------------------------------------------------------------------------

interface R4NEndpointDescriptor {
  path: string;
  preGuardAnchors: string[];
}

const R4N_ENDPOINTS: R4NEndpointDescriptor[] = [
  {
    path: "supabase/functions/build-kpi-app-payload/index.ts",
    preGuardAnchors: [
      "get_kpi_app_outbox_admin",
      "get_kpi_app_payload_source",
      "buildKpiAppPayload(",
      "createClient(SUPABASE_URL, SERVICE_KEY",
      "kpi_app_submission_outbox",
    ],
  },
];

for (const desc of R4N_ENDPOINTS) {
  Deno.test(
    `R4N endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*userClient\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(userClient)`,
        );
      }

      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, ANON_KEY",
      );
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const serviceRoleClientIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_KEY",
      );
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstDbIdx = [firstRpcIdx, firstFromIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        getUserIdx < 0 || reqJsonIdx < 0 || serviceRoleClientIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped userClient creation`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(
          `${desc.path}: guard must precede userClient.auth.getUser()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= serviceRoleClientIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      for (const anchor of desc.preGuardAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4N descriptor set contains exactly the KPI App Payload Builder endpoint",
  () => {
    assertEquals(R4N_ENDPOINTS.length, 1);
    assertEquals(
      R4N_ENDPOINTS[0].path,
      "supabase/functions/build-kpi-app-payload/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4O — AI Guide Admin Diagnostics
// -----------------------------------------------------------------------------

interface R4OEndpointDescriptor {
  path: string;
  hasAdminClient: boolean;
  getUserAnchor: string;
}

const R4O_ENDPOINTS: R4OEndpointDescriptor[] = [
  {
    path: "supabase/functions/ai-guide-v2-reindex/index.ts",
    hasAdminClient: true,
    getUserAnchor: "resolveAuthenticatedUserId(",
  },
  {
    path: "supabase/functions/ai-guide-v2-smoke/index.ts",
    hasAdminClient: true,
    getUserAnchor: "resolveAuthenticatedUserId(",
  },
  {
    path: "supabase/functions/ai-guide-v2-trace/index.ts",
    hasAdminClient: false,
    getUserAnchor: "userClient.auth.getUser(",
  },
];

for (const desc of R4O_ENDPOINTS) {
  Deno.test(
    `R4O endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*userClient\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(userClient)`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*supabase(?:Url|Url)\s*,\s*(?:anonKey|supabaseAnon)/,
      );
      const getUserIdx = handler.indexOf(desc.getUserAnchor);
      const reqJsonIdx = handler.indexOf("req.json(");
      const orgResolveIdx = handler.indexOf("resolveActiveOrganizationId(");
      const isOrgAdminIdx = handler.indexOf('rpc("is_org_admin"');
      const embeddingRuntimeIdx = handler.indexOf(
        "resolveGuideEmbeddingProviderRuntime(",
      );
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstDbIdx = [firstRpcIdx, firstFromIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || callerClientIdx < 0 || getUserIdx < 0 ||
        reqJsonIdx < 0 || orgResolveIdx < 0 || isOrgAdminIdx < 0 ||
        embeddingRuntimeIdx < 0 || firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped userClient creation`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(
          `${desc.path}: guard must precede auth.getUser/getClaims`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= orgResolveIdx) {
        throw new Error(
          `${desc.path}: guard must precede active-Organization resolution`,
        );
      }
      if (guardIdx >= isOrgAdminIdx) {
        throw new Error(`${desc.path}: guard must precede is_org_admin`);
      }
      if (guardIdx >= embeddingRuntimeIdx) {
        throw new Error(
          `${desc.path}: guard must precede embedding runtime resolution`,
        );
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      if (desc.hasAdminClient) {
        const serviceRoleClientIdx = handler.search(
          /createClient\(\s*supabaseUrl\s*,\s*serviceKey/,
        );
        if (serviceRoleClientIdx < 0) {
          throw new Error(
            `${desc.path}: service-role client construction not found`,
          );
        }
        if (guardIdx >= serviceRoleClientIdx) {
          throw new Error(
            `${desc.path}: guard must precede service-role client construction`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4O descriptor set contains exactly the three AI Guide admin diagnostics endpoints",
  () => {
    assertEquals(R4O_ENDPOINTS.length, 3);
    assertEquals(
      R4O_ENDPOINTS[0].path,
      "supabase/functions/ai-guide-v2-reindex/index.ts",
    );
    assertEquals(
      R4O_ENDPOINTS[1].path,
      "supabase/functions/ai-guide-v2-smoke/index.ts",
    );
    assertEquals(
      R4O_ENDPOINTS[2].path,
      "supabase/functions/ai-guide-v2-trace/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4P — BTPM Guide chat runtimes
// -----------------------------------------------------------------------------

interface R4PEndpointDescriptor {
  path: string;
  callerClientVar: string;
  callerClientPattern: RegExp;
  authAnchor: string;
}

const R4P_ENDPOINTS: R4PEndpointDescriptor[] = [
  {
    path: "supabase/functions/ai-guide-v2-chat/index.ts",
    callerClientVar: "userClient",
    callerClientPattern:
      /const\s+userClient\s*=\s*createClient\(\s*supabaseUrl\s*,\s*supabaseAnon/,
    authAnchor: "userClient.auth.getUser(",
  },
  {
    path: "supabase/functions/ai-help-chat/index.ts",
    callerClientVar: "supabase",
    callerClientPattern:
      /const\s+supabase\s*=\s*createClient\(\s*\n?\s*Deno\.env\.get\(\s*"SUPABASE_URL"/,
    authAnchor: "supabase.auth.getClaims(",
  },
];

for (const desc of R4P_ENDPOINTS) {
  Deno.test(
    `R4P endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerMatch = desc.callerClientPattern.exec(handler);
      const callerClientIdx = callerMatch ? callerMatch.index : -1;
      const authIdx = handler.indexOf(desc.authAnchor);
      const reqJsonIdx = handler.indexOf("req.json(");
      const orgResolveIdx = handler.indexOf("resolveActiveOrganizationId(");
      const firstRpcIdx = handler.indexOf(".rpc(");
      const firstFromIdx = handler.indexOf(".from(");
      const dbIdxCandidates = [firstRpcIdx, firstFromIdx].filter((v) => v >= 0);
      const firstDbIdx = dbIdxCandidates.length > 0
        ? dbIdxCandidates.reduce((a, b) => (a < b ? a : b))
        : -1;

      if (
        guardIdx < 0 || callerClientIdx < 0 || authIdx < 0 ||
        reqJsonIdx < 0 || orgResolveIdx < 0
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped ${desc.callerClientVar} creation`,
        );
      }
      if (guardIdx >= authIdx) {
        throw new Error(
          `${desc.path}: guard must precede auth.getUser/getClaims`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= orgResolveIdx) {
        throw new Error(
          `${desc.path}: guard must precede active-Organization resolution`,
        );
      }
      if (firstDbIdx >= 0 && guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      // Endpoint-specific downstream anchors — pipeline / provider work.
      if (desc.path.endsWith("ai-guide-v2-chat/index.ts")) {
        const handleIdx = handler.indexOf("handleGuideV2Request(");
        const textRuntimeIdx = handler.indexOf(
          "resolveGuideTextProviderRuntime(",
        );
        const embedRuntimeIdx = handler.indexOf(
          "resolveGuideEmbeddingProviderRuntime(",
        );
        if (handleIdx < 0 || textRuntimeIdx < 0 || embedRuntimeIdx < 0) {
          throw new Error(
            `${desc.path}: expected V2 pipeline anchor markers missing`,
          );
        }
        if (guardIdx >= handleIdx) {
          throw new Error(
            `${desc.path}: guard must precede handleGuideV2Request`,
          );
        }
        if (guardIdx >= textRuntimeIdx || guardIdx >= embedRuntimeIdx) {
          throw new Error(
            `${desc.path}: guard must precede provider runtime resolution`,
          );
        }
      } else {
        const providerIdx = handler.indexOf(
          "resolveGuideTextProviderRuntime(",
        );
        const completionIdx = handler.indexOf("postTenantAiChatCompletion(");
        if (providerIdx < 0 || completionIdx < 0) {
          throw new Error(
            `${desc.path}: expected provider/completion anchor markers missing`,
          );
        }
        if (guardIdx >= providerIdx) {
          throw new Error(
            `${desc.path}: guard must precede provider runtime resolution`,
          );
        }
        if (guardIdx >= completionIdx) {
          throw new Error(
            `${desc.path}: guard must precede postTenantAiChatCompletion`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4P descriptor set contains exactly the two BTPM Guide chat runtime endpoints",
  () => {
    assertEquals(R4P_ENDPOINTS.length, 2);
    assertEquals(
      R4P_ENDPOINTS[0].path,
      "supabase/functions/ai-guide-v2-chat/index.ts",
    );
    assertEquals(
      R4P_ENDPOINTS[1].path,
      "supabase/functions/ai-help-chat/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4Q — Organization User Deletion
// -----------------------------------------------------------------------------

interface R4QEndpointDescriptor {
  path: string;
  preGuardAnchors: string[];
}

const R4Q_ENDPOINTS: R4QEndpointDescriptor[] = [
  {
    path: "supabase/functions/admin-delete-user/index.ts",
    preGuardAnchors: [
      "callerClient.auth.getUser(",
      "req.json(",
      "is_org_admin",
      "createClient(supabaseUrl, serviceRoleKey",
      "from(\"profiles\")",
      "admin_delete_user",
      "from(\"invitations\")",
      "adminClient.auth.admin.deleteUser(",
    ],
  },
];

for (const desc of R4Q_ENDPOINTS) {
  Deno.test(
    `R4Q endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      if (!/createSupabaseTokenVerifier\(\s*callerClient\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(callerClient)`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(supabaseUrl, anonKey",
      );
      const getUserIdx = handler.indexOf("callerClient.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const serviceRoleClientIdx = handler.indexOf(
        "createClient(supabaseUrl, serviceRoleKey",
      );
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        getUserIdx < 0 || reqJsonIdx < 0 || serviceRoleClientIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped callerClient creation`,
        );
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(
          `${desc.path}: guard must precede callerClient.auth.getUser()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= serviceRoleClientIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      for (const anchor of desc.preGuardAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4Q descriptor set contains exactly the Organization User Deletion endpoint",
  () => {
    assertEquals(R4Q_ENDPOINTS.length, 1);
    assertEquals(
      R4Q_ENDPOINTS[0].path,
      "supabase/functions/admin-delete-user/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4R — User Invitation Creation
// -----------------------------------------------------------------------------

interface R4REndpointDescriptor {
  path: string;
  callerClientVar: string;
  preGuardAnchors: string[];
}

const R4R_ENDPOINTS: R4REndpointDescriptor[] = [
  {
    path: "supabase/functions/invite-user/index.ts",
    callerClientVar: "callerClient",
    preGuardAnchors: [
      "callerClient.auth.getClaims(",
      "req.json(",
      "is_org_admin",
      "createClient(supabaseUrl, serviceRoleKey",
      "admin_resend_invitation",
      "admin_create_invitation",
      "adminClient.auth.admin.",
    ],
  },
];

for (const desc of R4R_ENDPOINTS) {
  Deno.test(
    `R4R endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) {
        throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      }
      const handler = src.slice(serveIdx);

      if (
        !raw.includes(
          `from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`,
        )
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(
          `${desc.path}: missing createSupabaseTokenVerifier import`,
        );
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(
        guardCalls.length,
        1,
        `${desc.path}: expected exactly one assertBrowserSessionOnly call`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }

      if (
        !/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)
      ) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');
      const callerClientIdx = handler.indexOf(
        "createClient(supabaseUrl, anonKey",
      );
      const getClaimsIdx = handler.indexOf("callerClient.auth.getClaims(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const serviceRoleClientIdx = handler.indexOf(
        "createClient(supabaseUrl, serviceRoleKey",
      );
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);

      if (
        guardIdx < 0 || optionsIdx < 0 || callerClientIdx < 0 ||
        getClaimsIdx < 0 || reqJsonIdx < 0 || serviceRoleClientIdx < 0 ||
        firstDbIdx === Number.MAX_SAFE_INTEGER
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }
      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must come after caller-scoped ${desc.callerClientVar} creation`,
        );
      }
      if (guardIdx >= getClaimsIdx) {
        throw new Error(
          `${desc.path}: guard must precede callerClient.auth.getClaims()`,
        );
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= serviceRoleClientIdx) {
        throw new Error(
          `${desc.path}: guard must precede service-role client construction`,
        );
      }
      if (guardIdx >= firstDbIdx) {
        throw new Error(
          `${desc.path}: guard must precede first database query or RPC`,
        );
      }

      for (const anchor of desc.preGuardAnchors) {
        const idx = handler.indexOf(anchor);
        if (idx < 0) {
          throw new Error(`${desc.path}: expected anchor ${anchor} not found`);
        }
        if (guardIdx >= idx) {
          throw new Error(
            `${desc.path}: guard must precede ${anchor}`,
          );
        }
      }

      const inviteUserByEmailIdx = handler.indexOf(
        "adminClient.auth.admin.inviteUserByEmail(",
      );
      if (inviteUserByEmailIdx >= 0 && guardIdx >= inviteUserByEmailIdx) {
        throw new Error(
          `${desc.path}: guard must precede adminClient.auth.admin.inviteUserByEmail(...)`,
        );
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (
        const forgedHeader of [
          "X-BTPM-Client-ID",
          "x-btpm-client-id",
          "x-client-id",
        ]
      ) {
        if (
          new RegExp(
            `headers\\.get\\(\\s*["']${forgedHeader}["']`,
            "i",
          ).test(handler)
        ) {
          throw new Error(
            `${desc.path}: must not read forged client header ${forgedHeader}`,
          );
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from query or body`,
        );
      }
    },
  );
}

Deno.test(
  "R4R descriptor set contains exactly the User Invitation Creation endpoint",
  () => {
    assertEquals(R4R_ENDPOINTS.length, 1);
    assertEquals(
      R4R_ENDPOINTS[0].path,
      "supabase/functions/invite-user/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4S — Invitation Redemption
// -----------------------------------------------------------------------------

interface R4SEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4S_ENDPOINTS: R4SEndpointDescriptor[] = [
  {
    path: "supabase/functions/redeem-invitations/index.ts",
    callerClientVar: "callerClient",
  },
];

for (const desc of R4S_ENDPOINTS) {
  Deno.test(
    `R4S endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (
        !raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.indexOf("createClient(supabaseUrl, anonKey");
      const reqJsonIdx = handler.indexOf("req.json(");
      const invitationIdParseIdx = handler.indexOf("body?.invitation_id");
      const getUserIdx = handler.indexOf("callerClient.auth.getUser(");
      const serviceRoleIdx = handler.indexOf("createClient(supabaseUrl, serviceRoleKey");
      const invitationsFromIdx = handler.indexOf('.from("invitations"');
      const acceptRpcIdx = handler.indexOf("accept_pending_invitation_for_user");
      const autoAcceptIdx = handler.indexOf("auto_accept_pending_invitations");
      const profilesFromIdx = handler.indexOf('.from("profiles"');

      if (
        guardIdx < 0 || callerClientIdx < 0 || reqJsonIdx < 0 ||
        invitationIdParseIdx < 0 || getUserIdx < 0 || serviceRoleIdx < 0 ||
        invitationsFromIdx < 0 || acceptRpcIdx < 0 || autoAcceptIdx < 0 ||
        profilesFromIdx < 0
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(`${desc.path}: guard must follow caller-scoped ${desc.callerClientVar}`);
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= invitationIdParseIdx) {
        throw new Error(`${desc.path}: guard must precede invitation_id parsing`);
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(`${desc.path}: guard must precede callerClient.auth.getUser()`);
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(`${desc.path}: guard must precede service-role client construction`);
      }
      if (guardIdx >= invitationsFromIdx) {
        throw new Error(`${desc.path}: guard must precede invitation-table reads`);
      }
      if (guardIdx >= acceptRpcIdx) {
        throw new Error(`${desc.path}: guard must precede accept_pending_invitation_for_user`);
      }
      if (guardIdx >= autoAcceptIdx) {
        throw new Error(`${desc.path}: guard must precede auto_accept_pending_invitations`);
      }
      if (guardIdx >= profilesFromIdx) {
        throw new Error(`${desc.path}: guard must precede profile reconciliation query`);
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      // Original malformed-body fallback must remain.
      if (!/catch\s*\{[^}]*invitationId\s*=\s*null/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback missing`);
      }

      // No duplicate req.json() parsing.
      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: duplicate req.json() detected`);

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(`${desc.path}: must not derive client identity from query or body`);
      }
    },
  );
}

Deno.test(
  "R4S descriptor set contains exactly the Invitation Redemption endpoint",
  () => {
    assertEquals(R4S_ENDPOINTS.length, 1);
    assertEquals(
      R4S_ENDPOINTS[0].path,
      "supabase/functions/redeem-invitations/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4T — Lifecycle Hard Delete
// -----------------------------------------------------------------------------

interface R4TEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4T_ENDPOINTS: R4TEndpointDescriptor[] = [
  {
    path: "supabase/functions/lifecycle-hard-delete/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4T_ENDPOINTS) {
  Deno.test(
    `R4T endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (
        !raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.indexOf("createClient(supabaseUrl, anonKey");
      const reqJsonIdx = handler.indexOf("req.json(");
      const targetTypeIdx = handler.indexOf("body?.target_type");
      const targetIdIdx = handler.indexOf("body?.target_id");
      const targetValidationIdx = handler.indexOf("HARD_DELETE_RPC[targetType]");
      const idValidationIdx = handler.indexOf('typeof targetId !== "string"');
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const serviceRoleIdx = handler.indexOf("createClient(supabaseUrl, serviceKey");
      const orgTableIdx = handler.indexOf("ORG_TABLE[targetType]");
      const fromTblIdx = handler.indexOf(".from(tbl)");
      const rpcIdx = handler.indexOf("userClient.rpc(rpcName");

      if (
        guardIdx < 0 || callerClientIdx < 0 || reqJsonIdx < 0 ||
        targetTypeIdx < 0 || targetIdIdx < 0 || targetValidationIdx < 0 ||
        idValidationIdx < 0 || getUserIdx < 0 || serviceRoleIdx < 0 ||
        orgTableIdx < 0 || fromTblIdx < 0 || rpcIdx < 0
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(`${desc.path}: guard must follow caller-scoped ${desc.callerClientVar}`);
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= targetTypeIdx) {
        throw new Error(`${desc.path}: guard must precede target_type extraction`);
      }
      if (guardIdx >= targetIdIdx) {
        throw new Error(`${desc.path}: guard must precede target_id extraction`);
      }
      if (guardIdx >= targetValidationIdx) {
        throw new Error(`${desc.path}: guard must precede target-type validation`);
      }
      if (guardIdx >= idValidationIdx) {
        throw new Error(`${desc.path}: guard must precede target-id validation`);
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(`${desc.path}: guard must precede userClient.auth.getUser()`);
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(`${desc.path}: guard must precede service-role client construction`);
      }
      if (guardIdx >= orgTableIdx) {
        throw new Error(`${desc.path}: guard must precede ORG_TABLE[targetType]`);
      }
      if (guardIdx >= fromTblIdx) {
        throw new Error(`${desc.path}: guard must precede .from(tbl)`);
      }
      if (guardIdx >= rpcIdx) {
        throw new Error(`${desc.path}: guard must precede canonical hard-delete RPC`);
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      if (!/\.catch\s*\(\s*\(\)\s*=>\s*\(\{\}\)\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: duplicate req.json() detected`);

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(`${desc.path}: must not derive client identity from query or body`);
      }
    },
  );
}

// -----------------------------------------------------------------------------
// API-E.R4U — Manual KPI App Report Preparation
// -----------------------------------------------------------------------------

interface R4UEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4U_ENDPOINTS: R4UEndpointDescriptor[] = [
  {
    path: "supabase/functions/prepare-kpi-app-report-now/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4U_ENDPOINTS) {
  Deno.test(
    `R4U endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (
        !raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.indexOf("createClient(SUPABASE_URL, ANON_KEY");
      const reqJsonIdx = handler.indexOf("req.json(");
      const allowedKeysIdx = handler.indexOf("ALLOWED_KEYS");
      const mappingIdIdx = handler.indexOf("b.mapping_id");
      const periodStartIdx = handler.indexOf("b.reporting_period_start");
      const periodEndIdx = handler.indexOf("b.reporting_period_end");
      const validityDateIdx = handler.indexOf("b.validity_date");
      const actionIdx = handler.indexOf("b.action");
      const dateValidationIdx = handler.indexOf("isValidIsoDate(periodStart)");
      const periodOrderIdx = handler.indexOf("reporting_period_end < reporting_period_start");
      const actionValidationIdx = handler.indexOf('action !== "preview"');
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const mappingAdminIdx = handler.indexOf("get_kpi_app_mapping_admin");
      const selectIdx = handler.indexOf("prepare_kpi_app_report_now_select");
      const serviceRoleIdx = handler.indexOf("createClient(SUPABASE_URL, SERVICE_KEY");
      const outboxIdx = handler.indexOf('"kpi_app_submission_outbox"');
      const decryptedIdx = handler.indexOf("get_kpi_snapshot_decrypted_for_mapping");

      if (
        guardIdx < 0 || callerClientIdx < 0 || reqJsonIdx < 0 ||
        allowedKeysIdx < 0 || mappingIdIdx < 0 || periodStartIdx < 0 ||
        periodEndIdx < 0 || validityDateIdx < 0 || actionIdx < 0 ||
        dateValidationIdx < 0 || periodOrderIdx < 0 || actionValidationIdx < 0 ||
        getUserIdx < 0 || mappingAdminIdx < 0 || selectIdx < 0 ||
        serviceRoleIdx < 0 || outboxIdx < 0 || decryptedIdx < 0
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(`${desc.path}: guard must follow caller-scoped ${desc.callerClientVar}`);
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= allowedKeysIdx) {
        throw new Error(`${desc.path}: guard must precede ALLOWED_KEYS`);
      }
      if (guardIdx >= mappingIdIdx) {
        throw new Error(`${desc.path}: guard must precede mapping_id extraction`);
      }
      if (guardIdx >= periodStartIdx || guardIdx >= periodEndIdx || guardIdx >= validityDateIdx) {
        throw new Error(`${desc.path}: guard must precede date extraction`);
      }
      if (guardIdx >= actionIdx) {
        throw new Error(`${desc.path}: guard must precede action extraction`);
      }
      if (guardIdx >= dateValidationIdx || guardIdx >= periodOrderIdx || guardIdx >= actionValidationIdx) {
        throw new Error(`${desc.path}: guard must precede body validation`);
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(`${desc.path}: guard must precede userClient.auth.getUser()`);
      }
      if (guardIdx >= mappingAdminIdx) {
        throw new Error(`${desc.path}: guard must precede get_kpi_app_mapping_admin`);
      }
      if (guardIdx >= selectIdx) {
        throw new Error(`${desc.path}: guard must precede prepare_kpi_app_report_now_select`);
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(`${desc.path}: guard must precede service-role client construction`);
      }
      if (guardIdx >= outboxIdx) {
        throw new Error(`${desc.path}: guard must precede kpi_app_submission_outbox access`);
      }
      if (guardIdx >= decryptedIdx) {
        throw new Error(`${desc.path}: guard must precede get_kpi_snapshot_decrypted_for_mapping`);
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      if (!/\.catch\s*\(\s*\(\)\s*=>\s*\(\{\}\s+as\s+Record<string,\s*unknown>\)\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: duplicate req.json() detected`);

      const allowedKeysBlocks = handler.match(/ALLOWED_KEYS\s*=\s*new\s+Set/g) ?? [];
      assertEquals(allowedKeysBlocks.length, 1, `${desc.path}: duplicate ALLOWED_KEYS block detected`);

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(`${desc.path}: must not derive client identity from query or body`);
      }
    },
  );
}

Deno.test(
  "R4U descriptor set contains exactly the Manual KPI App Report Preparation endpoint",
  () => {
    assertEquals(R4U_ENDPOINTS.length, 1);
    assertEquals(
      R4U_ENDPOINTS[0].path,
      "supabase/functions/prepare-kpi-app-report-now/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4V — Manual KPI App Payload Submission
// -----------------------------------------------------------------------------

interface R4VEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4V_ENDPOINTS: R4VEndpointDescriptor[] = [
  {
    path: "supabase/functions/submit-kpi-app-payload/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4V_ENDPOINTS) {
  Deno.test(
    `R4V endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (
        !raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }
      if (!raw.includes(`from "../_shared/kpi-app-submit-service.ts"`)) {
        throw new Error(`${desc.path}: must import shared submitOutboxCore helper`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }
      if (!/submitOutboxCore\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must delegate to submitOutboxCore`);
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.indexOf("createClient(SUPABASE_URL, ANON_KEY");
      const reqJsonIdx = handler.indexOf("req.json(");
      const allowedKeysIdx = handler.indexOf("ALLOWED_KEYS");
      const outboxIdIdx = handler.indexOf("const outboxId");
      const uuidValidationIdx = handler.indexOf("UUID_RE.test(outboxId)");
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const adminGateIdx = handler.indexOf("get_kpi_app_outbox_admin");
      const sourceRpcIdx = handler.indexOf("get_kpi_app_payload_source");
      const serviceRoleIdx = handler.indexOf("createClient(SUPABASE_URL, SERVICE_KEY");
      const submitCoreIdx = handler.indexOf("submitOutboxCore(");

      if (
        guardIdx < 0 || callerClientIdx < 0 || reqJsonIdx < 0 ||
        allowedKeysIdx < 0 || outboxIdIdx < 0 || uuidValidationIdx < 0 ||
        getUserIdx < 0 || adminGateIdx < 0 || sourceRpcIdx < 0 ||
        serviceRoleIdx < 0 || submitCoreIdx < 0
      ) {
        throw new Error(`${desc.path}: expected anchor markers missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(`${desc.path}: guard must follow caller-scoped ${desc.callerClientVar}`);
      }
      if (guardIdx >= reqJsonIdx) {
        throw new Error(`${desc.path}: guard must precede req.json()`);
      }
      if (guardIdx >= allowedKeysIdx) {
        throw new Error(`${desc.path}: guard must precede ALLOWED_KEYS`);
      }
      if (guardIdx >= outboxIdIdx) {
        throw new Error(`${desc.path}: guard must precede outbox_id extraction`);
      }
      if (guardIdx >= uuidValidationIdx) {
        throw new Error(`${desc.path}: guard must precede UUID validation`);
      }
      if (guardIdx >= getUserIdx) {
        throw new Error(`${desc.path}: guard must precede userClient.auth.getUser()`);
      }
      if (guardIdx >= adminGateIdx) {
        throw new Error(`${desc.path}: guard must precede get_kpi_app_outbox_admin`);
      }
      if (guardIdx >= sourceRpcIdx) {
        throw new Error(`${desc.path}: guard must precede get_kpi_app_payload_source`);
      }
      if (guardIdx >= serviceRoleIdx) {
        throw new Error(`${desc.path}: guard must precede service-role client construction`);
      }
      if (guardIdx >= submitCoreIdx) {
        throw new Error(`${desc.path}: guard must precede submitOutboxCore`);
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      if (!/\.catch\s*\(\s*\(\)\s*=>\s*\(\{\}\s+as\s+Record<string,\s*unknown>\)\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: duplicate req.json() detected`);

      const allowedKeysBlocks = handler.match(/ALLOWED_KEYS\s*=\s*new\s+Set/g) ?? [];
      assertEquals(allowedKeysBlocks.length, 1, `${desc.path}: duplicate ALLOWED_KEYS block detected`);

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(`${desc.path}: must not derive client identity from query or body`);
      }
    },
  );
}

Deno.test(
  "R4V descriptor set contains exactly the Manual KPI App Payload Submission endpoint",
  () => {
    assertEquals(R4V_ENDPOINTS.length, 1);
    assertEquals(
      R4V_ENDPOINTS[0].path,
      "supabase/functions/submit-kpi-app-payload/index.ts",
    );
  },
);

Deno.test(
  "R4V shared submission helper remains unguarded",
  async () => {
    const helper = await Deno.readTextFile(
      "supabase/functions/_shared/kpi-app-submit-service.ts",
    );
    if (/assertBrowserSessionOnly/.test(helper)) {
      throw new Error("shared submit helper must not contain browser-session guard");
    }
    // Scheduler is guarded at R4Y (human-admin path only). System-mode path
    // remains unguarded by construction; asserted in the R4Y suite.
  },
);


// -----------------------------------------------------------------------------
// API-E.R4W — Manual KPI App Submission Retry
// -----------------------------------------------------------------------------

interface R4WEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4W_ENDPOINTS: R4WEndpointDescriptor[] = [
  {
    path: "supabase/functions/retry-kpi-app-submission/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4W_ENDPOINTS) {
  Deno.test(
    `R4W endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (
        !raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.indexOf("createClient(SUPABASE_URL, ANON_KEY");
      const reqJsonIdx = handler.indexOf("req.json(");
      const allowedKeysIdx = handler.indexOf("ALLOWED_KEYS");
      const outboxIdIdx = handler.indexOf("const outboxId");
      const uuidValidationIdx = handler.indexOf("UUID_RE.test(outboxId)");
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const adminGateIdx = handler.indexOf("get_kpi_app_outbox_admin");
      const serviceRoleIdx = handler.indexOf("createClient(SUPABASE_URL, SERVICE_KEY");
      const modeQueryIdx = handler.indexOf("submission_mode");
      const systemBundleIdx = handler.indexOf("loadPayloadSourceBundleSystem(");
      const sourceRpcIdx = handler.indexOf("get_kpi_app_payload_source");
      const buildIdx = handler.indexOf("buildKpiAppPayload(");
      const resolveCfgIdx = handler.indexOf("resolveTenantMulesoftKpiRuntimeConfig(");
      const submittingIdx = handler.indexOf('"submitting"');
      const submitCallIdx = handler.indexOf("submitKpiAppPayload(");
      const attemptInsertIdx = handler.indexOf("kpi_app_submission_attempts");

      const anchors = {
        guardIdx, callerClientIdx, reqJsonIdx, allowedKeysIdx, outboxIdIdx,
        uuidValidationIdx, getUserIdx, adminGateIdx, serviceRoleIdx,
        modeQueryIdx, systemBundleIdx, sourceRpcIdx, buildIdx, resolveCfgIdx,
        submittingIdx, submitCallIdx, attemptInsertIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(`${desc.path}: guard must follow caller-scoped ${desc.callerClientVar}`);
      }
      const mustPrecede: Array<[string, number]> = [
        ["req.json()", reqJsonIdx],
        ["ALLOWED_KEYS", allowedKeysIdx],
        ["outbox_id extraction", outboxIdIdx],
        ["UUID validation", uuidValidationIdx],
        ["userClient.auth.getUser()", getUserIdx],
        ["get_kpi_app_outbox_admin", adminGateIdx],
        ["service-role client construction", serviceRoleIdx],
        ["submission_mode query", modeQueryIdx],
        ["loadPayloadSourceBundleSystem", systemBundleIdx],
        ["get_kpi_app_payload_source", sourceRpcIdx],
        ["buildKpiAppPayload", buildIdx],
        ["resolveTenantMulesoftKpiRuntimeConfig", resolveCfgIdx],
        ["submitting transition", submittingIdx],
        ["submitKpiAppPayload", submitCallIdx],
        ["submission-attempt insertion", attemptInsertIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      if (!/\.catch\s*\(\s*\(\)\s*=>\s*\(\{\}\s+as\s+Record<string,\s*unknown>\)\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: duplicate req.json() detected`);

      const allowedKeysBlocks = handler.match(/ALLOWED_KEYS\s*=\s*new\s+Set/g) ?? [];
      assertEquals(allowedKeysBlocks.length, 1, `${desc.path}: duplicate ALLOWED_KEYS block detected`);

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(`${desc.path}: must not derive client identity from query or body`);
      }

      if (!/loadPayloadSourceBundleSystem\(/.test(handler)) {
        throw new Error(`${desc.path}: scheduled-row system-bundle logic must remain present`);
      }
    },
  );
}

Deno.test(
  "R4W descriptor set contains exactly the Manual KPI App Submission Retry endpoint",
  () => {
    assertEquals(R4W_ENDPOINTS.length, 1);
    assertEquals(
      R4W_ENDPOINTS[0].path,
      "supabase/functions/retry-kpi-app-submission/index.ts",
    );
  },
);

Deno.test(
  "R4W scheduler, shared helpers and system loader remain unguarded",
  async () => {
    const paths = [
      // Scheduler is guarded at R4Y (human-admin path only); excluded here.
      "supabase/functions/_shared/kpi-app-submit-service.ts",
      "supabase/functions/_shared/kpi-app-payload-source-system.ts",
      "supabase/functions/_shared/kpi-app-payload-builder.ts",
      "supabase/functions/_shared/kpi-app-mulesoft-client.ts",
    ];
    for (const p of paths) {
      const src = await Deno.readTextFile(p);
      if (/assertBrowserSessionOnly/.test(src)) {
        throw new Error(`${p}: must not contain browser-session guard`);
      }
    }
  },
);


// -----------------------------------------------------------------------------
// API-E.R4X — KPI App Submission Reconciliation
// -----------------------------------------------------------------------------

interface R4XEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4X_ENDPOINTS: R4XEndpointDescriptor[] = [
  {
    path: "supabase/functions/reconcile-kpi-app-submission/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4X_ENDPOINTS) {
  Deno.test(
    `R4X endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (
        !raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)
      ) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.indexOf("createClient(SUPABASE_URL, ANON_KEY");
      const reqJsonIdx = handler.indexOf("req.json(");
      const allowedKeysIdx = handler.indexOf("ALLOWED_KEYS");
      const outboxIdIdx = handler.indexOf("const outboxId");
      const actionIdx = handler.indexOf("const action");
      const uuidValidationIdx = handler.indexOf("UUID_RE.test(outboxId)");
      const allowedActionsIdx = handler.indexOf("ALLOWED_ACTIONS.has(action)");
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const adminGateIdx = handler.indexOf("get_kpi_app_outbox_admin");
      const serviceRoleIdx = handler.indexOf("createClient(SUPABASE_URL, SERVICE_KEY");
      const outboxTableIdx = handler.indexOf("kpi_app_submission_outbox");
      const submittingIdx = handler.indexOf('"submitting"');
      const staleIdx = handler.indexOf("STALE_AFTER_MS");
      const updateIdx = handler.indexOf(".update(");

      const anchors = {
        guardIdx, callerClientIdx, reqJsonIdx, allowedKeysIdx, outboxIdIdx,
        actionIdx, uuidValidationIdx, allowedActionsIdx, getUserIdx,
        adminGateIdx, serviceRoleIdx, outboxTableIdx, submittingIdx,
        staleIdx, updateIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(`${desc.path}: guard must follow caller-scoped ${desc.callerClientVar}`);
      }
      const mustPrecede: Array<[string, number]> = [
        ["req.json()", reqJsonIdx],
        ["ALLOWED_KEYS", allowedKeysIdx],
        ["outbox_id extraction", outboxIdIdx],
        ["action extraction", actionIdx],
        ["UUID validation", uuidValidationIdx],
        ["ALLOWED_ACTIONS validation", allowedActionsIdx],
        ["userClient.auth.getUser()", getUserIdx],
        ["get_kpi_app_outbox_admin", adminGateIdx],
        ["service-role client construction", serviceRoleIdx],
        ["kpi_app_submission_outbox access", outboxTableIdx],
        ["status evaluation", submittingIdx],
        ["staleness evaluation", staleIdx],
        ["conditional reconciliation update", updateIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      if (!/\.catch\s*\(\s*\(\)\s*=>\s*\(\{\}\s+as\s+Record<string,\s*unknown>\)\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: duplicate req.json() detected`);

      const allowedKeysBlocks = handler.match(/ALLOWED_KEYS\s*=\s*new\s+Set/g) ?? [];
      assertEquals(allowedKeysBlocks.length, 1, `${desc.path}: duplicate ALLOWED_KEYS block detected`);

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(`${desc.path}: must not derive client identity from query or body`);
      }

      if (/submitKpiAppPayload\(/.test(handler)) {
        throw new Error(`${desc.path}: must not invoke MuleSoft submission helper`);
      }
      if (/submitOutboxCore\(/.test(handler)) {
        throw new Error(`${desc.path}: must not invoke submission lifecycle helper`);
      }
      if (/loadPayloadSourceBundleSystem\(/.test(handler)) {
        throw new Error(`${desc.path}: must not invoke scheduler system-bundle loader`);
      }
      if (/kpi_app_submission_attempts/.test(handler)) {
        throw new Error(`${desc.path}: must not insert submission attempts`);
      }
    },
  );
}

Deno.test(
  "R4X descriptor set contains exactly the KPI App Submission Reconciliation endpoint",
  () => {
    assertEquals(R4X_ENDPOINTS.length, 1);
    assertEquals(
      R4X_ENDPOINTS[0].path,
      "supabase/functions/reconcile-kpi-app-submission/index.ts",
    );
  },
);


// -----------------------------------------------------------------------------
// API-E.R4Y — Guard the Human Path of the KPI App Scheduler
// -----------------------------------------------------------------------------

interface R4YEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4Y_ENDPOINTS: R4YEndpointDescriptor[] = [
  {
    path: "supabase/functions/run-kpi-app-scheduler/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4Y_ENDPOINTS) {
  Deno.test(
    `R4Y endpoint ${desc.path} integrates the browser-only guard correctly (hybrid human-admin path)`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      // Exactly one guard invocation and one caller-scoped client construction.
      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(SUPABASE_URL, ANON_KEY, ...)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }

      // Guard AND caller-client construction must be structurally inside
      // an `if (authHeader)` block.
      const ifAuthMatch =
        /if\s*\(\s*authHeader\s*\)\s*\{([\s\S]*?)\n\s{0,6}\}\s*\n\s*\n\s*const\s+body\s*=/.exec(
          handler,
        );
      if (!ifAuthMatch) {
        throw new Error(
          `${desc.path}: could not locate the pre-body \`if (authHeader) { ... }\` block preceding \`const body =\``,
        );
      }
      const ifAuthBody = ifAuthMatch[1];
      if (!/assertBrowserSessionOnly\s*\(/.test(ifAuthBody)) {
        throw new Error(
          `${desc.path}: guard must live inside the \`if (authHeader)\` block`,
        );
      }
      if (!/createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/.test(ifAuthBody)) {
        throw new Error(
          `${desc.path}: caller-scoped client must be constructed inside \`if (authHeader)\``,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/,
      );
      const reqJsonIdx = handler.indexOf("req.json(");
      const allowedKeysIdx = handler.indexOf("ALLOWED_KEYS");
      const modeExtractIdx = handler.indexOf("const mode = b.mode");
      const asOfDateExtractIdx = handler.indexOf("b.as_of_date");
      const mappingIdExtractIdx = handler.indexOf("b.mapping_id");
      const invocationSourceExtractIdx = handler.indexOf("b.invocation_source");
      const asOfDateTimeExtractIdx = handler.indexOf("b.as_of_datetime_utc");
      const modeValidationIdx = handler.indexOf('mode !== "dry_run"');
      const uuidValidationIdx = handler.indexOf("UUID_RE.test(");
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const getUserOrgIdx = handler.indexOf("get_user_org_id");
      const isOrgAdminIdx = handler.indexOf("is_org_admin");
      const mappingAdminIdx = handler.indexOf("get_kpi_app_mapping_admin");
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_KEY",
      );

      const anchors = {
        guardIdx, callerClientIdx, reqJsonIdx, allowedKeysIdx,
        modeExtractIdx, asOfDateExtractIdx, mappingIdExtractIdx,
        invocationSourceExtractIdx, asOfDateTimeExtractIdx,
        modeValidationIdx, uuidValidationIdx, getUserIdx,
        getUserOrgIdx, isOrgAdminIdx, mappingAdminIdx, serviceRoleIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["req.json()", reqJsonIdx],
        ["ALLOWED_KEYS", allowedKeysIdx],
        ["mode extraction", modeExtractIdx],
        ["as_of_date extraction", asOfDateExtractIdx],
        ["mapping_id extraction", mappingIdExtractIdx],
        ["invocation_source extraction", invocationSourceExtractIdx],
        ["as_of_datetime_utc extraction", asOfDateTimeExtractIdx],
        ["mode validation", modeValidationIdx],
        ["mapping UUID validation", uuidValidationIdx],
        ["userClient.auth.getUser()", getUserIdx],
        ["get_user_org_id", getUserOrgIdx],
        ["is_org_admin", isOrgAdminIdx],
        ["get_kpi_app_mapping_admin", mappingAdminIdx],
        ["service-role adminClient construction", serviceRoleIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      // Guard must precede the first DB access after the caller client.
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      // Malformed-body fallback preserved.
      if (!/\.catch\s*\(\s*\(\)\s*=>\s*\(\{\}\s+as\s+Record<string,\s*unknown>\)\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: duplicate req.json() detected`);

      const allowedKeysBlocks = handler.match(/ALLOWED_KEYS\s*=\s*new\s+Set/g) ?? [];
      assertEquals(
        allowedKeysBlocks.length,
        1,
        `${desc.path}: duplicate ALLOWED_KEYS block detected`,
      );

      // System-mode contract preserved.
      if (!/verifySchedulerSecret\s*\(\s*req\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: system mode must still call verifySchedulerSecret(req)`);
      }
      if (!/KPI_APP_SCHEDULER_ENABLED/.test(handler)) {
        throw new Error(`${desc.path}: system mode must still gate on KPI_APP_SCHEDULER_ENABLED`);
      }
      if (!/system mode rejects Authorization header/.test(handler)) {
        throw new Error(`${desc.path}: system mode must still reject Authorization header`);
      }
      if (!/system mode does not accept mapping_id/.test(handler)) {
        throw new Error(`${desc.path}: system mode must still reject mapping_id`);
      }
      if (!/system mode requires mode=execute/.test(handler)) {
        throw new Error(`${desc.path}: system mode must still require mode=execute`);
      }

      // Forbidden authorities.
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }
    },
  );
}

Deno.test(
  "R4Y descriptor set contains exactly the KPI App Scheduler human-path endpoint",
  () => {
    assertEquals(R4Y_ENDPOINTS.length, 1);
    assertEquals(
      R4Y_ENDPOINTS[0].path,
      "supabase/functions/run-kpi-app-scheduler/index.ts",
    );
  },
);

Deno.test(
  "R4Y cron wrapper and shared scheduler/system helpers remain unguarded",
  async () => {
    const unguarded = [
      "supabase/functions/run-kpi-app-scheduler-cron/index.ts",
      "supabase/functions/_shared/kpi-app-scheduler-auth.ts",
      "supabase/functions/_shared/kpi-app-submit-service.ts",
      "supabase/functions/_shared/kpi-app-payload-source-system.ts",
      "supabase/functions/_shared/kpi-app-outbox-system-service.ts",
    ];
    for (const path of unguarded) {
      const raw = await Deno.readTextFile(path);
      if (raw.includes("assertBrowserSessionOnly")) {
        throw new Error(`${path}: must not add browser-session guard`);
      }
      if (/authenticateApiRequest\s*\(/.test(raw)) {
        throw new Error(`${path}: must not call authenticateApiRequest`);
      }
    }
  },
);


// -----------------------------------------------------------------------------
// API-E.R4Z — Guard the Human Path of the KPI Snapshot Capture Scheduler
// -----------------------------------------------------------------------------

interface R4ZEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4Z_ENDPOINTS: R4ZEndpointDescriptor[] = [
  {
    path: "supabase/functions/run-kpi-snapshot-capture-scheduler/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4Z_ENDPOINTS) {
  Deno.test(
    `R4Z endpoint ${desc.path} integrates the browser-only guard correctly (hybrid human-admin path)`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(SUPABASE_URL, ANON_KEY, ...)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }

      // Guard AND caller-client construction must be structurally inside
      // an `if (authHeader)` block that precedes `const body =`.
      const ifAuthMatch =
        /if\s*\(\s*authHeader\s*\)\s*\{([\s\S]*?)\n\s{0,6}\}\s*\n\s*\n\s*const\s+body\s*=/.exec(
          handler,
        );
      if (!ifAuthMatch) {
        throw new Error(
          `${desc.path}: could not locate the pre-body \`if (authHeader) { ... }\` block preceding \`const body =\``,
        );
      }
      const ifAuthBody = ifAuthMatch[1];
      if (!/assertBrowserSessionOnly\s*\(/.test(ifAuthBody)) {
        throw new Error(
          `${desc.path}: guard must live inside the \`if (authHeader)\` block`,
        );
      }
      if (!/createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/.test(ifAuthBody)) {
        throw new Error(
          `${desc.path}: caller-scoped client must be constructed inside \`if (authHeader)\``,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/,
      );
      const reqJsonIdx = handler.indexOf("req.json(");
      const allowedKeysIdx = handler.indexOf("ALLOWED_KEYS");
      const modeValidationIdx = handler.indexOf('b.mode !== "dry_run"');
      const dateValidationIdx = handler.indexOf("isValidIsoDate(b.as_of_date");
      const parseUuidIdx = handler.indexOf("function parseUuid(");
      const orgFilterIdx = handler.indexOf('parseUuid("organization_id"');
      const wsFilterIdx = handler.indexOf('parseUuid("workspace_id"');
      const projectFilterIdx = handler.indexOf('parseUuid("project_id"');
      const kpiFilterIdx = handler.indexOf('parseUuid("kpi_definition_id"');
      const invocationSourceExtractIdx = handler.indexOf("b.invocation_source");
      const asOfDateTimeExtractIdx = handler.indexOf("b.as_of_datetime_utc");
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const getUserOrgIdx = handler.indexOf("get_user_org_id");
      const kpiDefinitionsIdx = handler.indexOf('.from("kpi_definitions"');
      const projectsIdx = handler.indexOf('.from("projects"');
      const isOrgAdminIdx = handler.indexOf("is_org_admin");
      const isWorkspaceAdminIdx = handler.indexOf("is_workspace_admin_or_higher");
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_KEY",
      );

      const anchors = {
        guardIdx, callerClientIdx, reqJsonIdx, allowedKeysIdx,
        modeValidationIdx, dateValidationIdx, parseUuidIdx,
        orgFilterIdx, wsFilterIdx, projectFilterIdx, kpiFilterIdx,
        invocationSourceExtractIdx, asOfDateTimeExtractIdx,
        getUserIdx, getUserOrgIdx, kpiDefinitionsIdx, projectsIdx,
        isOrgAdminIdx, isWorkspaceAdminIdx, serviceRoleIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["req.json()", reqJsonIdx],
        ["ALLOWED_KEYS", allowedKeysIdx],
        ["mode validation", modeValidationIdx],
        ["as_of_date validation", dateValidationIdx],
        ["parseUuid helper", parseUuidIdx],
        ["organization_id filter extraction", orgFilterIdx],
        ["workspace_id filter extraction", wsFilterIdx],
        ["project_id filter extraction", projectFilterIdx],
        ["kpi_definition_id filter extraction", kpiFilterIdx],
        ["invocation_source extraction", invocationSourceExtractIdx],
        ["as_of_datetime_utc extraction", asOfDateTimeExtractIdx],
        ["userClient.auth.getUser()", getUserIdx],
        ["get_user_org_id", getUserOrgIdx],
        ["first user-scoped kpi_definitions access", kpiDefinitionsIdx],
        ["first user-scoped projects access", projectsIdx],
        ["is_org_admin", isOrgAdminIdx],
        ["is_workspace_admin_or_higher", isWorkspaceAdminIdx],
        ["service-role adminClient construction", serviceRoleIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      // Guard must precede the first DB access after the caller client.
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      // Malformed-body fallback preserved.
      if (!/\.catch\s*\(\s*\(\)\s*=>\s*\(\{\}\s+as\s+Record<string,\s*unknown>\)\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: duplicate req.json() detected`);

      const allowedKeysBlocks = handler.match(/ALLOWED_KEYS\s*=\s*new\s+Set/g) ?? [];
      assertEquals(
        allowedKeysBlocks.length,
        1,
        `${desc.path}: duplicate ALLOWED_KEYS block detected`,
      );

      const parseUuidHelpers = handler.match(/function\s+parseUuid\s*\(/g) ?? [];
      assertEquals(
        parseUuidHelpers.length,
        1,
        `${desc.path}: duplicate parseUuid helper detected`,
      );

      // System-mode contract preserved.
      if (!/verifySnapshotSchedulerSecret\s*\(\s*req\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: system mode must still call verifySnapshotSchedulerSecret(req)`,
        );
      }
      if (!/isSnapshotSchedulerEnabled\s*\(/.test(handler)) {
        throw new Error(
          `${desc.path}: system mode must still gate on isSnapshotSchedulerEnabled()`,
        );
      }
      if (!/system mode requires mode=execute/.test(handler)) {
        throw new Error(`${desc.path}: system mode must still require mode=execute`);
      }
      if (!/system mode rejects Authorization header/.test(handler)) {
        throw new Error(`${desc.path}: system mode must still reject Authorization header`);
      }
      if (
        !/system mode does not accept organization_id \/ workspace_id \/ project_id \/ kpi_definition_id/
          .test(handler)
      ) {
        throw new Error(
          `${desc.path}: system mode must still reject scoped filters`,
        );
      }
      if (!/requestedBy:\s*null/.test(handler)) {
        throw new Error(
          `${desc.path}: system-mode invocation must still pass requestedBy: null`,
        );
      }

      // Shared post-authority pipeline reuse — a single runSchedulerCore
      // definition and two callers (system-mode branch + user-mode branch).
      const runCoreDefs = handler.match(/async\s+function\s+runSchedulerCore\s*\(/g) ?? [];
      assertEquals(
        runCoreDefs.length,
        1,
        `${desc.path}: runSchedulerCore must be defined exactly once`,
      );
      const runCoreCalls = handler.match(/runSchedulerCore\s*\(/g) ?? [];
      if (runCoreCalls.length < 3) {
        // 1 definition + 2 call sites (system + user)
        throw new Error(
          `${desc.path}: runSchedulerCore must be called from both system and user paths`,
        );
      }

      // Forbidden authorities.
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }
    },
  );
}

Deno.test(
  "R4Z descriptor set contains exactly the KPI Snapshot Capture Scheduler human-path endpoint",
  () => {
    assertEquals(R4Z_ENDPOINTS.length, 1);
    assertEquals(
      R4Z_ENDPOINTS[0].path,
      "supabase/functions/run-kpi-snapshot-capture-scheduler/index.ts",
    );
  },
);

Deno.test(
  "R4Z cron wrapper and shared snapshot-scheduler / KPI helpers remain unguarded",
  async () => {
    const unguarded = [
      "supabase/functions/run-kpi-snapshot-capture-scheduler-cron/index.ts",
      "supabase/functions/_shared/kpi-snapshot-scheduler-auth.ts",
      "supabase/functions/_shared/kpi/kpiPreviousPeriod.ts",
      "supabase/functions/_shared/kpi/kpiCalculationEngine.ts",
      "supabase/functions/_shared/kpi/kpiCalculationDataAdapter.ts",
      "supabase/functions/_shared/kpi/automaticKpiLibrary.ts",
      "supabase/functions/_shared/kpi/kpiSnapshotNarrative.ts",
      "supabase/functions/_shared/kpi/kpiScheduleDue.ts",
    ];
    for (const path of unguarded) {
      const raw = await Deno.readTextFile(path);
      if (raw.includes("assertBrowserSessionOnly")) {
        throw new Error(`${path}: must not add browser-session guard`);
      }
      if (/authenticateApiRequest\s*\(/.test(raw)) {
        throw new Error(`${path}: must not call authenticateApiRequest`);
      }
    }
  },
);


// -----------------------------------------------------------------------------
// API-E.R4AA — Guard Server-Authoritative KPI Snapshot Capture
// -----------------------------------------------------------------------------

interface R4AAEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4AA_ENDPOINTS: R4AAEndpointDescriptor[] = [
  {
    path: "supabase/functions/capture-kpi-snapshot/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4AA_ENDPOINTS) {
  Deno.test(
    `R4AA endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*supabaseUrl\s*,\s*anonKey/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(supabaseUrl, anonKey, ...)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*supabaseUrl\s*,\s*anonKey/,
      );
      const reqJsonIdx = handler.indexOf("req.json(");
      const kpiDefIdExtractIdx = handler.indexOf("body?.kpi_definition_id");
      const snapshotDateExtractIdx = handler.indexOf("body?.snapshot_date");
      const commentExtractIdx = handler.indexOf("body?.comment");
      const actionPlanExtractIdx = handler.indexOf("body?.action_plan");
      const uuidValidationIdx = handler.indexOf("UUID_RE.test(");
      const isoDateValidationIdx = handler.indexOf("ISO_DATE_RE.test(");
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const canCaptureIdx = handler.indexOf("can_capture_kpi_snapshot");
      const serviceRoleIdx = handler.indexOf(
        "createClient(supabaseUrl, serviceKey",
      );
      const kpiDefinitionsIdx = handler.indexOf('.from("kpi_definitions"');
      const resolveKpiPeriodIdx = handler.indexOf("resolveKpiPeriod(");
      const getLatestManualIdx = handler.indexOf("get_latest_manual_kpi_value");
      const buildInputIdx = handler.indexOf("buildKpiCalculationInput(");
      const calcAutomaticIdx = handler.indexOf("calculateAutomaticKpi(");
      const insertIdx = handler.indexOf('.from("kpi_snapshots")');

      const anchors = {
        guardIdx, callerClientIdx, reqJsonIdx,
        kpiDefIdExtractIdx, snapshotDateExtractIdx, commentExtractIdx, actionPlanExtractIdx,
        uuidValidationIdx, isoDateValidationIdx,
        getUserIdx, canCaptureIdx, serviceRoleIdx, kpiDefinitionsIdx,
        resolveKpiPeriodIdx, getLatestManualIdx, buildInputIdx, calcAutomaticIdx, insertIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["req.json()", reqJsonIdx],
        ["kpi_definition_id extraction", kpiDefIdExtractIdx],
        ["snapshot_date extraction", snapshotDateExtractIdx],
        ["comment extraction", commentExtractIdx],
        ["action_plan extraction", actionPlanExtractIdx],
        ["UUID validation", uuidValidationIdx],
        ["ISO date validation", isoDateValidationIdx],
        ["userClient.auth.getUser()", getUserIdx],
        ["can_capture_kpi_snapshot", canCaptureIdx],
        ["service-role client construction", serviceRoleIdx],
        ["first kpi_definitions access", kpiDefinitionsIdx],
        ["resolveKpiPeriod", resolveKpiPeriodIdx],
        ["get_latest_manual_kpi_value", getLatestManualIdx],
        ["buildKpiCalculationInput", buildInputIdx],
        ["calculateAutomaticKpi", calcAutomaticIdx],
        ["kpi_snapshots insertion", insertIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      // Guard must precede the first DB access after the caller client.
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      // Service-role client must remain AFTER can_capture_kpi_snapshot.
      if (serviceRoleIdx <= canCaptureIdx) {
        throw new Error(
          `${desc.path}: service-role client must be constructed after can_capture_kpi_snapshot`,
        );
      }

      // Malformed-body fallback preserved.
      if (!/req\.json\(\)\.catch\(\s*\(\)\s*=>\s*\(\{\}\)\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      // No strict allow-list newly introduced.
      if (/ALLOWED_KEYS\s*=\s*new\s+Set/.test(handler)) {
        throw new Error(`${desc.path}: no strict allow-list must be introduced in this step`);
      }

      // Exactly one user-client construction.
      const userClientDecls = handler.match(/const\s+userClient\s*=/g) ?? [];
      assertEquals(
        userClientDecls.length,
        1,
        `${desc.path}: exactly one userClient construction expected`,
      );

      // Forbidden authorities.
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // No scheduler / cron / KPI App / MuleSoft invocation added.
      for (
        const forbidden of [
          "run-kpi-app-scheduler",
          "run-kpi-snapshot-capture-scheduler",
          "submit-kpi-app-payload",
          "retry-kpi-app-submission",
          "reconcile-kpi-app-submission",
          "mulesoft",
          "MuleSoft",
        ]
      ) {
        if (handler.includes(forbidden)) {
          throw new Error(`${desc.path}: must not invoke ${forbidden}`);
        }
      }
    },
  );
}

Deno.test(
  "R4AA descriptor set contains exactly the KPI Snapshot Capture endpoint",
  () => {
    assertEquals(R4AA_ENDPOINTS.length, 1);
    assertEquals(
      R4AA_ENDPOINTS[0].path,
      "supabase/functions/capture-kpi-snapshot/index.ts",
    );
  },
);

Deno.test(
  "R4AA shared KPI helpers remain unguarded",
  async () => {
    const unguarded = [
      "supabase/functions/_shared/kpi/kpiCalculationEngine.ts",
      "supabase/functions/_shared/kpi/kpiCalculationDataAdapter.ts",
      "supabase/functions/_shared/kpi/kpiPeriod.ts",
      "supabase/functions/_shared/kpi/automaticKpiLibrary.ts",
    ];
    for (const path of unguarded) {
      const raw = await Deno.readTextFile(path);
      if (raw.includes("assertBrowserSessionOnly")) {
        throw new Error(`${path}: must not add browser-session guard`);
      }
      if (/authenticateApiRequest\s*\(/.test(raw)) {
        throw new Error(`${path}: must not call authenticateApiRequest`);
      }
    }
  },
);



Deno.test(
  "R4T descriptor set contains exactly the Lifecycle Hard Delete endpoint",
  () => {
    assertEquals(R4T_ENDPOINTS.length, 1);
    assertEquals(
      R4T_ENDPOINTS[0].path,
      "supabase/functions/lifecycle-hard-delete/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4AB — Guard KPI Schedule-Policy Dry-Run Evaluation
// -----------------------------------------------------------------------------

interface R4ABEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4AB_ENDPOINTS: R4ABEndpointDescriptor[] = [
  {
    path: "supabase/functions/evaluate-kpi-schedule-policies/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4AB_ENDPOINTS) {
  Deno.test(
    `R4AB endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(SUPABASE_URL, ANON_KEY, ...)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/,
      );
      const reqJsonIdx = handler.indexOf("req.json(");
      const allowedKeysIdx = handler.indexOf("ALLOWED_KEYS");
      const modeExtractIdx = handler.indexOf("b.mode");
      const asOfExtractIdx = handler.indexOf("b.as_of_datetime_utc");
      const wsExtractIdx = handler.indexOf("b.workspace_id");
      const processExtractIdx = handler.indexOf("b.process_type");
      const cadenceExtractIdx = handler.indexOf("b.cadence");
      const modeValidationIdx = handler.indexOf('"dry_run"');
      const dateParseIdx = handler.indexOf("new Date(b.as_of_datetime_utc");
      const uuidValidationIdx = handler.indexOf("UUID_RE.test(");
      const processValidationIdx = handler.indexOf("ALLOWED_PROCESS_TYPES.has(");
      const cadenceValidationIdx = handler.indexOf("ALLOWED_CADENCES.has(");
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const getUserOrgIdx = handler.indexOf('"get_user_org_id"');
      const isOrgAdminRpcIdx = handler.indexOf('"is_org_admin"');
      const isWsAdminRpcIdx = handler.indexOf('"is_workspace_admin_or_higher"');
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_KEY",
      );
      const policiesFromIdx = handler.indexOf('.from("kpi_schedule_policies"');
      const workspacesFromIdx = handler.indexOf('.from("workspaces"');
      const evalDueIdx = handler.indexOf("evaluateKpiSchedulePolicyDue(");

      const anchors = {
        guardIdx, callerClientIdx, reqJsonIdx, allowedKeysIdx,
        modeExtractIdx, asOfExtractIdx, wsExtractIdx, processExtractIdx, cadenceExtractIdx,
        modeValidationIdx, dateParseIdx, uuidValidationIdx,
        processValidationIdx, cadenceValidationIdx,
        getUserIdx, getUserOrgIdx, isOrgAdminRpcIdx, isWsAdminRpcIdx,
        serviceRoleIdx, policiesFromIdx, workspacesFromIdx, evalDueIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["req.json()", reqJsonIdx],
        ["ALLOWED_KEYS", allowedKeysIdx],
        ["mode extraction", modeExtractIdx],
        ["as_of_datetime_utc extraction", asOfExtractIdx],
        ["workspace_id extraction", wsExtractIdx],
        ["process_type extraction", processExtractIdx],
        ["cadence extraction", cadenceExtractIdx],
        ["mode dry_run validation", modeValidationIdx],
        ["ISO datetime parsing", dateParseIdx],
        ["workspace UUID validation", uuidValidationIdx],
        ["process_type allow-list validation", processValidationIdx],
        ["cadence allow-list validation", cadenceValidationIdx],
        ["userClient.auth.getUser()", getUserIdx],
        ["get_user_org_id RPC", getUserOrgIdx],
        ["is_org_admin RPC", isOrgAdminRpcIdx],
        ["is_workspace_admin_or_higher RPC", isWsAdminRpcIdx],
        ["service-role client construction", serviceRoleIdx],
        ["kpi_schedule_policies access", policiesFromIdx],
        ["workspaces lookup", workspacesFromIdx],
        ["evaluateKpiSchedulePolicyDue", evalDueIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      // Guard must precede the first DB access after the caller client.
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      // Service-role client must remain AFTER all required human authority checks.
      if (serviceRoleIdx <= getUserOrgIdx) {
        throw new Error(
          `${desc.path}: service-role client must be constructed after get_user_org_id`,
        );
      }
      if (serviceRoleIdx <= isOrgAdminRpcIdx) {
        throw new Error(
          `${desc.path}: service-role client must be constructed after is_org_admin`,
        );
      }
      if (serviceRoleIdx <= isWsAdminRpcIdx) {
        throw new Error(
          `${desc.path}: service-role client must be constructed after is_workspace_admin_or_higher`,
        );
      }

      // Malformed-body fallback preserved.
      if (!/req\.json\(\)\.catch\(\s*\(\)\s*=>\s*\(\{\}[^)]*\)\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      const allowedKeysBlocks = handler.match(/ALLOWED_KEYS\s*=\s*new\s+Set/g) ?? [];
      assertEquals(
        allowedKeysBlocks.length,
        1,
        `${desc.path}: exactly one ALLOWED_KEYS block expected`,
      );

      const userClientDecls = handler.match(/const\s+userClient\s*=/g) ?? [];
      assertEquals(
        userClientDecls.length,
        1,
        `${desc.path}: exactly one userClient construction expected`,
      );

      // Forbidden authorities.
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // No writes, no scheduler/cron/KPI App/MuleSoft/outbox/attempt invocations.
      for (
        const forbidden of [
          ".insert(", ".update(", ".upsert(", ".delete(",
          "storage.from(",
          "run-kpi-app-scheduler",
          "run-kpi-snapshot-capture-scheduler",
          "capture-kpi-snapshot",
          "submit-kpi-app-payload",
          "retry-kpi-app-submission",
          "reconcile-kpi-app-submission",
          "prepare-kpi-app-report-now",
          "build-kpi-app-payload",
          "kpi_app_submission_outbox",
          "kpi_app_submission_attempts",
          "mulesoft",
          "MuleSoft",
        ]
      ) {
        if (handler.includes(forbidden)) {
          throw new Error(`${desc.path}: must not include ${forbidden}`);
        }
      }

      // Runtime compatibility: the browser-session verifier calls auth.getClaims(),
      // which requires the Deno/esm Supabase JS client to be pinned to 2.50.0.
      if (!raw.includes("https://esm.sh/@supabase/supabase-js@2.50.0")) {
        throw new Error(
          `${desc.path}: must pin @supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (raw.includes("https://esm.sh/@supabase/supabase-js@2.49.1")) {
        throw new Error(
          `${desc.path}: must not retain the @supabase/supabase-js@2.49.1 pin`,
        );
      }
    },
  );
}

Deno.test(
  "R4AB descriptor set contains exactly the KPI Schedule-Policy Dry-Run endpoint",
  () => {
    assertEquals(R4AB_ENDPOINTS.length, 1);
    assertEquals(
      R4AB_ENDPOINTS[0].path,
      "supabase/functions/evaluate-kpi-schedule-policies/index.ts",
    );
  },
);

Deno.test(
  "R4AB shared due-engine and cron wrappers remain unguarded",
  async () => {
    const unguarded = [
      "supabase/functions/_shared/kpi/kpiScheduleDue.ts",
      "supabase/functions/run-kpi-app-scheduler-cron/index.ts",
      "supabase/functions/run-kpi-snapshot-capture-scheduler-cron/index.ts",
    ];
    for (const path of unguarded) {
      const raw = await Deno.readTextFile(path);
      if (raw.includes("assertBrowserSessionOnly")) {
        throw new Error(`${path}: must not add browser-session guard`);
      }
      if (/authenticateApiRequest\s*\(/.test(raw)) {
        throw new Error(`${path}: must not call authenticateApiRequest`);
      }
    }
  },
);

// -----------------------------------------------------------------------------
// API-E.R4AC — Guard KPI Automation Protocol JSON Export
// -----------------------------------------------------------------------------

interface R4ACEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4AC_ENDPOINTS: R4ACEndpointDescriptor[] = [
  {
    path: "supabase/functions/export-kpi-automation-protocol/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4AC_ENDPOINTS) {
  Deno.test(
    `R4AC endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      // Runtime compatibility pin.
      if (!raw.includes("https://esm.sh/@supabase/supabase-js@2.50.0")) {
        throw new Error(
          `${desc.path}: must pin @supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (raw.includes("https://esm.sh/@supabase/supabase-js@2.49.1")) {
        throw new Error(
          `${desc.path}: must not retain the @supabase/supabase-js@2.49.1 pin`,
        );
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(SUPABASE_URL, ANON_KEY, ...)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*cors\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, cors)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*ANON_KEY/,
      );
      const reqJsonIdx = handler.indexOf("req.json(");
      const periodStartIdx = handler.indexOf("body.period_start");
      const periodEndIdx = handler.indexOf("body.period_end");
      const workspaceIdIdx = handler.indexOf("body.workspace_id");
      const externalKpiIdsIdx = handler.indexOf("body.external_kpi_ids");
      const includeSnapIdx = handler.indexOf("body.include_snapshot_protocol");
      const includeSubmitIdx = handler.indexOf("body.include_submit_protocol");
      const includeOutboxIdx = handler.indexOf("body.include_outbox_history");
      const includeAttemptsIdx = handler.indexOf("body.include_attempts");
      const dateValidationIdx = handler.indexOf("isDate(periodStart)");
      const wsUuidValidationIdx = handler.indexOf("UUID_RE.test(body.workspace_id");
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const getUserOrgIdx = handler.indexOf('"get_user_org_id"');
      const isOrgAdminRpcIdx = handler.indexOf('"is_org_admin"');
      const isWsAdminRpcIdx = handler.indexOf('"is_workspace_admin_or_higher"');
      const serviceRoleIdx = handler.indexOf(
        "createClient(SUPABASE_URL, SERVICE_KEY",
      );
      const mappingsFromIdx = handler.indexOf('.from("kpi_app_mappings"');

      const anchors = {
        guardIdx, callerClientIdx, reqJsonIdx,
        periodStartIdx, periodEndIdx, workspaceIdIdx, externalKpiIdsIdx,
        includeSnapIdx, includeSubmitIdx, includeOutboxIdx, includeAttemptsIdx,
        dateValidationIdx, wsUuidValidationIdx,
        getUserIdx, getUserOrgIdx, isOrgAdminRpcIdx, isWsAdminRpcIdx,
        serviceRoleIdx, mappingsFromIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["req.json()", reqJsonIdx],
        ["period_start extraction", periodStartIdx],
        ["period_end extraction", periodEndIdx],
        ["workspace_id extraction", workspaceIdIdx],
        ["external_kpi_ids extraction", externalKpiIdsIdx],
        ["include_snapshot_protocol extraction", includeSnapIdx],
        ["include_submit_protocol extraction", includeSubmitIdx],
        ["include_outbox_history extraction", includeOutboxIdx],
        ["include_attempts extraction", includeAttemptsIdx],
        ["date validation", dateValidationIdx],
        ["workspace UUID validation", wsUuidValidationIdx],
        ["userClient.auth.getUser()", getUserIdx],
        ["get_user_org_id RPC", getUserOrgIdx],
        ["is_org_admin RPC", isOrgAdminRpcIdx],
        ["is_workspace_admin_or_higher RPC", isWsAdminRpcIdx],
        ["service-role client construction", serviceRoleIdx],
        ["kpi_app_mappings access", mappingsFromIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      if (serviceRoleIdx <= getUserOrgIdx) {
        throw new Error(
          `${desc.path}: service-role client must be constructed after get_user_org_id`,
        );
      }
      if (serviceRoleIdx <= isOrgAdminRpcIdx) {
        throw new Error(
          `${desc.path}: service-role client must be constructed after is_org_admin`,
        );
      }
      if (serviceRoleIdx <= isWsAdminRpcIdx) {
        throw new Error(
          `${desc.path}: service-role client must be constructed after is_workspace_admin_or_higher`,
        );
      }

      // Malformed-body fallback preserved.
      if (!/req\.json\(\)\.catch\(\s*\(\)\s*=>\s*\(\{\}\s*\)\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      // No strict extra-field allow-list should be introduced.
      if (/ALLOWED_KEYS\s*=\s*new\s+Set/.test(handler)) {
        throw new Error(`${desc.path}: strict extra-field allow-list must not be introduced`);
      }

      const userClientDecls = handler.match(/const\s+userClient\s*=/g) ?? [];
      assertEquals(
        userClientDecls.length,
        1,
        `${desc.path}: exactly one userClient construction expected`,
      );

      // Forbidden authorities.
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /\breq\.(url|body)\b[^;]*client_id/i.test(handler) ||
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // Strictly read-only: no writes, no operational external invocations.
      for (
        const forbidden of [
          ".insert(", ".update(", ".upsert(", ".delete(",
          "storage.from(",
          "run-kpi-app-scheduler",
          "run-kpi-snapshot-capture-scheduler",
          "capture-kpi-snapshot",
          "submit-kpi-app-payload",
          "retry-kpi-app-submission",
          "reconcile-kpi-app-submission",
          "prepare-kpi-app-report-now",
          "build-kpi-app-payload",
          "mulesoft",
          "MuleSoft",
        ]
      ) {
        if (handler.includes(forbidden)) {
          throw new Error(`${desc.path}: must not include ${forbidden}`);
        }
      }

      // Protected narrative values must be stripped; only *_present indicators remain.
      for (const raw3 of ["source_comment", "source_action_plan", "source_string_value"]) {
        // These names may still appear in select() (raw source read) and in
        // the destructuring that strips them, but must be destructured-out
        // before mapping to the safe object.
        // No explicit output assignment allowed.
        const assignRe = new RegExp(`[^_]${raw3}\\s*:`);
        if (assignRe.test(handler)) {
          throw new Error(`${desc.path}: must not assign ${raw3} to output`);
        }
      }
      for (const present of ["comment_present", "action_plan_present", "string_value_present"]) {
        if (!handler.includes(present)) {
          throw new Error(`${desc.path}: must expose ${present} presence indicator`);
        }
      }
    },
  );
}

Deno.test(
  "R4AC descriptor set contains exactly the KPI Automation Protocol export endpoint",
  () => {
    assertEquals(R4AC_ENDPOINTS.length, 1);
    assertEquals(
      R4AC_ENDPOINTS[0].path,
      "supabase/functions/export-kpi-automation-protocol/index.ts",
    );
  },
);

Deno.test(
  "R4AC cron wrappers remain unguarded",
  async () => {
    const unguarded = [
      "supabase/functions/run-kpi-app-scheduler-cron/index.ts",
      "supabase/functions/run-kpi-snapshot-capture-scheduler-cron/index.ts",
    ];
    for (const path of unguarded) {
      const raw = await Deno.readTextFile(path);
      if (raw.includes("assertBrowserSessionOnly")) {
        throw new Error(`${path}: must not add browser-session guard`);
      }
      if (/authenticateApiRequest\s*\(/.test(raw)) {
        throw new Error(`${path}: must not call authenticateApiRequest`);
      }
    }
  },
);

// -----------------------------------------------------------------------------
// API-E.R4AD — Guard KPI App System Email Read Endpoint
// -----------------------------------------------------------------------------

interface R4ADEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4AD_ENDPOINTS: R4ADEndpointDescriptor[] = [
  {
    path: "supabase/functions/get-kpi-app-system-email/index.ts",
    callerClientVar: "callerClient",
  },
];

for (const desc of R4AD_ENDPOINTS) {
  Deno.test(
    `R4AD endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      if (!raw.includes(`npm:@supabase/supabase-js@2.50.0`)) {
        throw new Error(
          `${desc.path}: must pin npm:@supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (/npm:@supabase\/supabase-js@2(?!\.50\.0)/.test(raw)) {
        throw new Error(
          `${desc.path}: must not retain the broad @supabase/supabase-js@2 pin`,
        );
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*supabaseUrl\s*,\s*anonKey/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(supabaseUrl, anonKey, ...)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*supabaseUrl\s*,\s*anonKey/,
      );
      const reqJsonIdx = handler.indexOf("req.json(");
      const orgIdIdx = handler.indexOf("body.organization_id");
      const wsIdIdx = handler.indexOf("body.workspace_id");
      const getUserIdx = handler.indexOf("callerClient.auth.getUser(");
      const isOrgAdminIdx = handler.indexOf('"is_org_admin"');
      const wsMembershipIdx = handler.indexOf('"workspace_memberships"');
      const envReadIdx = handler.indexOf("KPI_APP_SYSTEM_ENTERED_BY_EMAIL");

      const anchors = {
        guardIdx, callerClientIdx, reqJsonIdx, orgIdIdx, wsIdIdx,
        getUserIdx, isOrgAdminIdx, wsMembershipIdx, envReadIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["req.json()", reqJsonIdx],
        ["organization_id extraction", orgIdIdx],
        ["workspace_id extraction", wsIdIdx],
        ["callerClient.auth.getUser()", getUserIdx],
        ["is_org_admin RPC", isOrgAdminIdx],
        ["workspace_memberships query", wsMembershipIdx],
        ["KPI_APP_SYSTEM_ENTERED_BY_EMAIL env read", envReadIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      if (!/req\.json\(\)\.catch\(\s*\(\)\s*=>\s*\(\{\}\s*as\s+Record<string,\s*unknown>\)\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }
      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      if (/ALLOWED_KEYS\s*=\s*new\s+Set/.test(handler)) {
        throw new Error(`${desc.path}: strict extra-field allow-list must not be introduced`);
      }

      const callerClientDecls = handler.match(/const\s+callerClient\s*=/g) ?? [];
      assertEquals(
        callerClientDecls.length,
        1,
        `${desc.path}: exactly one callerClient construction expected`,
      );

      // No service-role construction.
      if (/SERVICE_ROLE|service_role|SUPABASE_SERVICE_ROLE_KEY/.test(handler)) {
        throw new Error(`${desc.path}: must not construct a service-role client`);
      }

      // Strictly read-only: no writes or external invocations.
      for (
        const forbidden of [
          ".insert(", ".update(", ".upsert(", ".delete(",
          "storage.from(",
          "functions.invoke(",
          "fetch(",
        ]
      ) {
        if (handler.includes(forbidden)) {
          throw new Error(`${desc.path}: must not include ${forbidden}`);
        }
      }

      // Forbidden authorities.
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // Response surface: only the existing controlled fields.
      if (!handler.includes("configured") || !handler.includes("system_entered_by_email")) {
        throw new Error(`${desc.path}: must retain existing controlled response fields`);
      }

      // Do not return or log the secret environment-variable name in error paths.
      if (/console\.[a-z]+\([^)]*KPI_APP_SYSTEM_ENTERED_BY_EMAIL/.test(handler)) {
        throw new Error(`${desc.path}: must not log the configured system-email secret name context`);
      }
      // The configured raw email must not be logged.
      if (/console\.[a-z]+\([^)]*\braw\b/.test(handler)) {
        throw new Error(`${desc.path}: must not log the configured email value`);
      }
    },
  );
}

Deno.test(
  "R4AD descriptor set contains exactly the KPI App System Email read endpoint",
  () => {
    assertEquals(R4AD_ENDPOINTS.length, 1);
    assertEquals(
      R4AD_ENDPOINTS[0].path,
      "supabase/functions/get-kpi-app-system-email/index.ts",
    );
  },
);

Deno.test(
  "R4AD cron wrapper remains unguarded",
  async () => {
    const path = "supabase/functions/run-kpi-app-scheduler-cron/index.ts";
    const raw = await Deno.readTextFile(path);
    if (raw.includes("assertBrowserSessionOnly")) {
      throw new Error(`${path}: must not add browser-session guard`);
    }
    if (/authenticateApiRequest\s*\(/.test(raw)) {
      throw new Error(`${path}: must not call authenticateApiRequest`);
    }
  },
);

// -----------------------------------------------------------------------------
// API-E.R4AE — Guard M365 PowerPoint Readiness Diagnostic
// -----------------------------------------------------------------------------

interface R4AEEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4AE_ENDPOINTS: R4AEEndpointDescriptor[] = [
  {
    path: "supabase/functions/m365-ppt-readiness-check/index.ts",
    callerClientVar: "supabase",
  },
];

for (const desc of R4AE_ENDPOINTS) {
  Deno.test(
    `R4AE endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      if (!raw.includes(`https://esm.sh/@supabase/supabase-js@2.50.0`)) {
        throw new Error(
          `${desc.path}: must pin @supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (raw.includes("@supabase/supabase-js@2.45.0")) {
        throw new Error(`${desc.path}: must not retain the 2.45.0 pin`);
      }
      if (raw.includes("@supabase/supabase-js@2.49.1")) {
        throw new Error(`${desc.path}: must not retain the 2.49.1 pin`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*SUPABASE_ANON_KEY/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(SUPABASE_URL, SUPABASE_ANON_KEY, ...)`,
      );

      const serviceCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*SERVICE_ROLE\s*\)/g) ?? [];
      assertEquals(
        serviceCtorMatches.length,
        1,
        `${desc.path}: expected exactly one service-role createClient(SUPABASE_URL, SERVICE_ROLE)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*SUPABASE_ANON_KEY/,
      );
      const serviceRoleIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*SERVICE_ROLE\s*\)/,
      );
      const getUserIdx = handler.indexOf("supabase.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const projectIdIdx = handler.indexOf("projectId");
      const authorityIdx = handler.indexOf('"has_project_pm_authority"');
      const projectReadIdx = handler.indexOf('.from("projects")');
      const wsBindingIdx = handler.indexOf('.from("sharepoint_workspace_bindings")');
      const projectBindingIdx = handler.indexOf('.from("sharepoint_project_bindings")');
      const buildPptxIdx = handler.indexOf("buildReadinessPptx(");
      const sessionIdx = handler.indexOf("createTenantSharePointPublishSession(");
      const targetIdx = handler.indexOf("resolveProjectDocumentPublishTarget(");
      const publishIdx = handler.indexOf("publishGeneratedDocumentBytes(");

      const anchors = {
        guardIdx, callerClientIdx, serviceRoleIdx, getUserIdx, reqJsonIdx,
        projectIdIdx, authorityIdx, projectReadIdx, wsBindingIdx,
        projectBindingIdx, buildPptxIdx, sessionIdx, targetIdx, publishIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["service-role construction", serviceRoleIdx],
        ["supabase.auth.getUser()", getUserIdx],
        ["req.json()", reqJsonIdx],
        ["has_project_pm_authority RPC", authorityIdx],
        ["projects table read", projectReadIdx],
        ["workspace binding read", wsBindingIdx],
        ["project binding read", projectBindingIdx],
        ["buildReadinessPptx", buildPptxIdx],
        ["createTenantSharePointPublishSession", sessionIdx],
        ["resolveProjectDocumentPublishTarget", targetIdx],
        ["publishGeneratedDocumentBytes", publishIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      // projectId extraction must follow the guard.
      if (guardIdx >= projectIdIdx) {
        throw new Error(`${desc.path}: guard must precede projectId extraction`);
      }

      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      if (!/req\.json\(\)\.catch\(\s*\(\)\s*=>\s*\(\{\}\s*as\s+Record<string,\s*unknown>\)\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain present`);
      }

      if (/ALLOWED_KEYS\s*=\s*new\s+Set/.test(handler)) {
        throw new Error(`${desc.path}: strict extra-field allow-list must not be introduced`);
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // Preserve authority + containment.
      if (!handler.includes("has_project_pm_authority")) {
        throw new Error(`${desc.path}: has_project_pm_authority must remain present`);
      }
      for (const cmp of [
        "wsBinding.workspace_id !== project.workspace_id",
        "wsBinding.organization_id !== project.organization_id",
        "projectBinding.project_id !== project.id",
        "projectBinding.workspace_id !== project.workspace_id",
        "projectBinding.organization_id !== project.organization_id",
      ]) {
        if (!handler.includes(cmp)) {
          throw new Error(`${desc.path}: containment comparison missing: ${cmp}`);
        }
      }
      if (
        !handler.includes(`wsBinding.binding_status !== "validated"`) ||
        !handler.includes(`projectBinding.binding_status !== "validated"`)
      ) {
        throw new Error(`${desc.path}: validated-binding requirements must remain`);
      }

      // Canonical publish call order.
      if (!(sessionIdx < targetIdx && targetIdx < publishIdx)) {
        throw new Error(`${desc.path}: canonical publish call order must be preserved`);
      }

      // Preserve filename, MIME type, operation, replace behavior.
      if (!handler.includes(`"BTPM PPT Readiness Check.pptx"`) && !raw.includes(`"BTPM PPT Readiness Check.pptx"`)) {
        throw new Error(`${desc.path}: filename must remain`);
      }
      if (!handler.includes("application/vnd.openxmlformats-officedocument.presentationml.presentation")) {
        throw new Error(`${desc.path}: PowerPoint MIME type must remain`);
      }
      if (!handler.includes(`"publish_ppt_readiness_diagnostic"`)) {
        throw new Error(`${desc.path}: operation must remain`);
      }
      if (!handler.includes(`conflictBehavior: "replace"`)) {
        throw new Error(`${desc.path}: replace behavior must remain`);
      }

      // No generated-document history write; no project/binding/health write.
      for (const forbiddenTable of [
        "generated_document_history",
        "sharepoint_workspace_bindings\").insert",
        "sharepoint_project_bindings\").insert",
        "sharepoint_workspace_bindings\").update",
        "sharepoint_project_bindings\").update",
        "sharepoint_workspace_bindings\").upsert",
        "sharepoint_project_bindings\").upsert",
        "integration_health",
      ]) {
        if (handler.includes(forbiddenTable)) {
          throw new Error(`${desc.path}: forbidden persistence detected: ${forbiddenTable}`);
        }
      }
      if (handler.includes(`.from("projects").update`) || handler.includes(`.from("projects").insert`)) {
        throw new Error(`${desc.path}: must not write to projects`);
      }
    },
  );
}

Deno.test(
  "R4AE descriptor set contains exactly the M365 PPT readiness diagnostic endpoint",
  () => {
    assertEquals(R4AE_ENDPOINTS.length, 1);
    assertEquals(
      R4AE_ENDPOINTS[0].path,
      "supabase/functions/m365-ppt-readiness-check/index.ts",
    );
  },
);

Deno.test(
  "R4AE shared publisher module remains free of endpoint-specific browser-session enforcement",
  async () => {
    const path = "supabase/functions/_shared/sharePointGeneratedDocumentPublisher.ts";
    const raw = await Deno.readTextFile(path);
    if (raw.includes("assertBrowserSessionOnly")) {
      throw new Error(`${path}: shared publisher must not embed browser-session guard`);
    }
  },
);

// -----------------------------------------------------------------------------
// API-E.R4AF — Guard Object-Context Email Sending
// -----------------------------------------------------------------------------

interface R4AFEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4AF_ENDPOINTS: R4AFEndpointDescriptor[] = [
  {
    path: "supabase/functions/send-object-email/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4AF_ENDPOINTS) {
  Deno.test(
    `R4AF endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      if (!raw.includes(`npm:@supabase/supabase-js@2.50.0`)) {
        throw new Error(
          `${desc.path}: must pin @supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (/@supabase\/supabase-js@2["'\s]/.test(raw) && !raw.includes(`@supabase/supabase-js@2.50.0`)) {
        throw new Error(`${desc.path}: must not retain broad @2 pin`);
      }
      if (/["']npm:@supabase\/supabase-js@2["']/.test(raw)) {
        throw new Error(`${desc.path}: broad npm:@supabase/supabase-js@2 pin must be absent`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*supabaseUrl\s*,\s*anonKey/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(supabaseUrl, anonKey, ...)`,
      );

      const serviceCtorMatches =
        handler.match(/createClient\(\s*supabaseUrl\s*,\s*serviceRoleKey\s*\)/g) ?? [];
      assertEquals(
        serviceCtorMatches.length,
        1,
        `${desc.path}: expected exactly one service-role createClient(supabaseUrl, serviceRoleKey)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*supabaseUrl\s*,\s*anonKey/,
      );
      const serviceRoleIdx = handler.search(
        /createClient\(\s*supabaseUrl\s*,\s*serviceRoleKey\s*\)/,
      );
      const tokenExtractIdx = handler.indexOf(`authHeader.replace("Bearer "`);
      const getClaimsIdx = handler.indexOf("userClient.auth.getClaims(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const authorityIdx = handler.indexOf('"has_project_pm_authority"');
      const decryptedProjectIdx = handler.indexOf('"get_decrypted_project"');
      const decryptedPhaseIdx = handler.indexOf('"get_decrypted_phase"');
      const decryptedTaskIdx = handler.indexOf('"get_decrypted_task"');
      const sendTenantIdx = handler.indexOf("sendTenantEmail(");
      const snapshotIdx = handler.indexOf('"record_object_email_snapshot"');

      const anchors = {
        guardIdx, callerClientIdx, serviceRoleIdx, tokenExtractIdx,
        getClaimsIdx, reqJsonIdx, authorityIdx, decryptedProjectIdx,
        decryptedPhaseIdx, decryptedTaskIdx, sendTenantIdx, snapshotIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["service-role construction", serviceRoleIdx],
        ["token extraction", tokenExtractIdx],
        ["userClient.auth.getClaims()", getClaimsIdx],
        ["req.json()", reqJsonIdx],
        ["has_project_pm_authority RPC", authorityIdx],
        ["get_decrypted_project RPC", decryptedProjectIdx],
        ["get_decrypted_phase RPC", decryptedPhaseIdx],
        ["get_decrypted_task RPC", decryptedTaskIdx],
        ["sendTenantEmail", sendTenantIdx],
        ["record_object_email_snapshot", snapshotIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      // Guard must precede first .rpc() / .from() request-handler DB op.
      const firstFromIdx = handler.indexOf(".from(", callerClientIdx);
      const firstRpcIdx = handler.indexOf(".rpc(", callerClientIdx);
      const firstDbIdx = [firstFromIdx, firstRpcIdx]
        .filter((v) => v >= 0)
        .reduce((a, b) => (a < b ? a : b), Number.MAX_SAFE_INTEGER);
      if (guardIdx >= firstDbIdx) {
        throw new Error(`${desc.path}: guard must precede first database query or RPC`);
      }

      // Request-field extraction must follow the guard.
      const bodyExtractIdx = handler.indexOf("target_type, target_id");
      if (bodyExtractIdx < 0 || guardIdx >= bodyExtractIdx) {
        throw new Error(`${desc.path}: guard must precede request-field extraction`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      if (!handler.includes(`"Invalid JSON body"`)) {
        throw new Error(`${desc.path}: existing invalid-JSON response must remain`);
      }

      if (/ALLOWED_KEYS\s*=\s*new\s+Set/.test(handler)) {
        throw new Error(`${desc.path}: strict extra-field allow-list must not be introduced`);
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // Preserve target types.
      for (const t of [`"project"`, `"phase"`, `"task"`]) {
        if (!handler.includes(t)) {
          throw new Error(`${desc.path}: target type ${t} must remain`);
        }
      }

      // Preserve limits.
      if (!handler.includes("Too many recipients (max 20)") || !handler.includes("20")) {
        throw new Error(`${desc.path}: 20-recipient maximum must remain`);
      }
      if (!handler.includes("4000")) {
        throw new Error(`${desc.path}: 4000-character message limit must remain`);
      }
      if (!handler.includes("200")) {
        throw new Error(`${desc.path}: 200-character subject limit must remain`);
      }

      // Project-scoped authority preserved.
      if (
        !/has_project_pm_authority[\s\S]{0,200}_project_id:\s*projectId/.test(handler)
      ) {
        throw new Error(`${desc.path}: has_project_pm_authority must remain project-scoped`);
      }

      // Tenant SMTP reason, function name, event key, metadata.
      if (!handler.includes(`reason: "send-object-email"`)) {
        throw new Error(`${desc.path}: sendTenantEmail reason must remain`);
      }
      if (!handler.includes(`functionName: "send-object-email"`)) {
        throw new Error(`${desc.path}: sendTenantEmail functionName must remain`);
      }
      if (!/const\s+eventKey\s*=\s*`object_context:\$\{target_type\}:\$\{target_id\}:\$\{to\.toLowerCase\(\)\}`/.test(handler)) {
        throw new Error(`${desc.path}: sendTenantEmail event key format must remain`);
      }
      if (!/metadata:\s*\{\s*target_type,\s*target_id\s*\}/.test(handler)) {
        throw new Error(`${desc.path}: sendTenantEmail metadata must remain`);
      }

      // Encrypted snapshot RPC and containment arguments.
      for (const arg of [
        "_organization_id: organizationId",
        "_workspace_id: workspaceId",
        "_target_type: target_type",
        "_target_id: target_id",
        "_payload: snapshotPayload",
      ]) {
        if (!handler.includes(arg)) {
          throw new Error(`${desc.path}: snapshot RPC argument missing: ${arg}`);
        }
      }

      // No direct provider or Graph send.
      if (/nodemailer/i.test(handler) || /graph\.microsoft\.com/i.test(handler)) {
        throw new Error(`${desc.path}: direct provider/Graph send must not be introduced`);
      }
      // No direct snapshot-table write.
      if (handler.includes(`.from("email_payload_snapshots")`)) {
        throw new Error(`${desc.path}: direct snapshot table write must not be introduced`);
      }
    },
  );
}

Deno.test(
  "R4AF descriptor set contains exactly the object-context email endpoint",
  () => {
    assertEquals(R4AF_ENDPOINTS.length, 1);
    assertEquals(
      R4AF_ENDPOINTS[0].path,
      "supabase/functions/send-object-email/index.ts",
    );
  },
);

Deno.test(
  "R4AF shared tenant outbound email module remains free of endpoint-specific browser-session enforcement",
  async () => {
    const path = "supabase/functions/_shared/tenantOutboundEmail.ts";
    const raw = await Deno.readTextFile(path);
    if (raw.includes("assertBrowserSessionOnly")) {
      throw new Error(`${path}: shared tenant email module must not embed browser-session guard`);
    }
  },
);

// -----------------------------------------------------------------------------
// API-E.R4AG — Guard Tenant SMTP Test Email
// -----------------------------------------------------------------------------

interface R4AGEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4AG_ENDPOINTS: R4AGEndpointDescriptor[] = [
  {
    path: "supabase/functions/send-test-email/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4AG_ENDPOINTS) {
  Deno.test(
    `R4AG endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      if (!raw.includes(`npm:@supabase/supabase-js@2.50.0`)) {
        throw new Error(
          `${desc.path}: must pin @supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (/["']npm:@supabase\/supabase-js@2["']/.test(raw)) {
        throw new Error(`${desc.path}: broad npm:@supabase/supabase-js@2 pin must be absent`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*supabaseUrl\s*,\s*anonKey/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(supabaseUrl, anonKey, ...)`,
      );

      const serviceCtorMatches =
        handler.match(/createClient\(\s*supabaseUrl\s*,\s*serviceKey/g) ?? [];
      assertEquals(
        serviceCtorMatches.length,
        1,
        `${desc.path}: expected exactly one service-role createClient(supabaseUrl, serviceKey, ...)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*supabaseUrl\s*,\s*anonKey/,
      );
      const serviceRoleIdx = handler.search(
        /createClient\(\s*supabaseUrl\s*,\s*serviceKey/,
      );
      const serviceKeyResolveIdx = handler.indexOf(`requireEnv("SUPABASE_SERVICE_ROLE_KEY")`);
      const getClaimsIdx = handler.indexOf("userClient.auth.getClaims(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const orgIdExtractIdx = handler.indexOf("body?.organization_id");
      const orgsFromIdx = handler.indexOf(`.from("organizations")`);
      const isTenantAdminIdx = handler.indexOf(`"is_tenant_admin"`);
      const isOrgAdminIdx = handler.indexOf(`"is_user_org_admin"`);
      const getUserByIdIdx = handler.indexOf("auth.admin.getUserById(");
      const renderIdx = handler.indexOf("renderBtpmEmail(");
      const sendTenantIdx = handler.indexOf("sendTenantEmail(");

      const anchors = {
        guardIdx, callerClientIdx, serviceRoleIdx, serviceKeyResolveIdx,
        getClaimsIdx, reqJsonIdx, orgIdExtractIdx, orgsFromIdx,
        isTenantAdminIdx, isOrgAdminIdx, getUserByIdIdx, renderIdx, sendTenantIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["userClient.auth.getClaims()", getClaimsIdx],
        ["req.json()", reqJsonIdx],
        ["organization_id extraction", orgIdExtractIdx],
        ["SUPABASE_SERVICE_ROLE_KEY resolution", serviceKeyResolveIdx],
        ["service-role construction", serviceRoleIdx],
        ["organizations table read", orgsFromIdx],
        ["is_tenant_admin RPC", isTenantAdminIdx],
        ["is_user_org_admin RPC", isOrgAdminIdx],
        ["auth.admin.getUserById", getUserByIdIdx],
        ["renderBtpmEmail", renderIdx],
        ["sendTenantEmail", sendTenantIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      if (!/req\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\s*as\s*any\)\)/.test(handler)) {
        throw new Error(`${desc.path}: malformed-body fallback must remain`);
      }

      if (/ALLOWED_KEYS\s*=\s*new\s+Set/.test(handler)) {
        throw new Error(`${desc.path}: strict extra-field allow-list must not be introduced`);
      }

      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // Bearer + empty-token validation remain.
      if (!handler.includes(`authHeader.startsWith("Bearer ")`)) {
        throw new Error(`${desc.path}: bearer-token validation must remain`);
      }
      if (!/if\s*\(\s*!token\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: empty-token validation must remain`);
      }

      // Caller ID / email come from authenticated claims.
      if (!handler.includes("claimsData.claims.sub")) {
        throw new Error(`${desc.path}: caller user id must come from JWT claims`);
      }
      if (!handler.includes("claimsData.claims.email")) {
        throw new Error(`${desc.path}: caller email must come from JWT claims`);
      }

      // Authority: Tenant Admin OR Org Admin — both preserved.
      if (
        !/is_tenant_admin[\s\S]{0,200}_tenant_id:\s*tenantId[\s\S]{0,200}_user_id:\s*callerUserId/.test(handler)
      ) {
        throw new Error(`${desc.path}: is_tenant_admin arguments must remain`);
      }
      if (
        !/is_user_org_admin[\s\S]{0,200}_user_id:\s*callerUserId[\s\S]{0,200}_organization_id:\s*organizationId/.test(handler)
      ) {
        throw new Error(`${desc.path}: is_user_org_admin arguments must remain`);
      }
      if (!/!isTenantAdmin\s*&&\s*!isOrgAdmin/.test(handler)) {
        throw new Error(`${desc.path}: Tenant Admin OR Org Admin authority must remain`);
      }
      if (/is_platform_super_admin|super_admin/i.test(handler)) {
        throw new Error(`${desc.path}: Platform Super Admin authority must not be introduced`);
      }

      // Recipient remains restricted to the authenticated user.
      if (!/requestedRecipient\s*!==\s*recipientEmail\.toLowerCase\(\)/.test(handler)) {
        throw new Error(`${desc.path}: recipient must remain restricted to the authenticated user`);
      }
      if (/\b(cc|bcc)\s*:/i.test(handler)) {
        throw new Error(`${desc.path}: CC/BCC recipient support must not be introduced`);
      }

      // Tenant SMTP event key, reason, function name, dedupe window, metadata.
      if (!handler.includes(`emailType: "test_email"`)) {
        throw new Error(`${desc.path}: sendTenantEmail emailType must remain`);
      }
      if (!/eventKey:\s*`test_email:\$\{organizationId\}:\$\{recipientEmail\.toLowerCase\(\)\}`/.test(handler)) {
        throw new Error(`${desc.path}: sendTenantEmail event key must remain`);
      }
      if (!handler.includes(`subject: "BTPM Test Email"`)) {
        throw new Error(`${desc.path}: sendTenantEmail subject must remain`);
      }
      if (!handler.includes(`reason: "test-email UI send"`)) {
        throw new Error(`${desc.path}: sendTenantEmail reason must remain`);
      }
      if (!handler.includes(`functionName: "send-test-email"`)) {
        throw new Error(`${desc.path}: sendTenantEmail functionName must remain`);
      }
      if (!/dedupeWindowSeconds:\s*30/.test(handler)) {
        throw new Error(`${desc.path}: sendTenantEmail 30-second dedupe window must remain`);
      }
      if (!/source:\s*"test-email-ui"/.test(handler)) {
        throw new Error(`${desc.path}: sendTenantEmail metadata source must remain`);
      }
      if (!/actor_user_id:\s*callerUserId/.test(handler)) {
        throw new Error(`${desc.path}: sendTenantEmail metadata actor_user_id must remain`);
      }

      // Response-status mapping preserved.
      for (const mapping of [
        `"skipped_non_production" ? 409`,
        `"skipped_duplicate" ? 429`,
        `"failed_configuration" ? 412`,
      ]) {
        if (!handler.includes(mapping)) {
          throw new Error(`${desc.path}: failure-status mapping must remain: ${mapping}`);
        }
      }
      if (!/:\s*502/.test(handler)) {
        throw new Error(`${desc.path}: 502 fallback mapping must remain`);
      }

      // No Graph, direct SMTP, global SMTP fallback, or direct secret access.
      if (/nodemailer/i.test(handler) || /graph\.microsoft\.com/i.test(handler)) {
        throw new Error(`${desc.path}: direct provider/Graph send must not be introduced`);
      }
      if (/smtp:\/\//i.test(handler) || /createTransport\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: direct SMTP transport must not be introduced`);
      }
      if (/SMTP_HOST|SMTP_USER|SMTP_PASS|SMTP_PORT/.test(handler)) {
        throw new Error(`${desc.path}: direct Tenant SMTP secret access must not be introduced`);
      }
    },
  );
}

Deno.test(
  "R4AG descriptor set contains exactly the tenant SMTP test email endpoint",
  () => {
    assertEquals(R4AG_ENDPOINTS.length, 1);
    assertEquals(
      R4AG_ENDPOINTS[0].path,
      "supabase/functions/send-test-email/index.ts",
    );
  },
);

// -----------------------------------------------------------------------------
// API-E.R4AH — Guard Team Work Reminder Emails
// -----------------------------------------------------------------------------

interface R4AHEndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const R4AH_ENDPOINTS: R4AHEndpointDescriptor[] = [
  {
    path: "supabase/functions/send-team-work-reminders/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of R4AH_ENDPOINTS) {
  Deno.test(
    `R4AH endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }

      if (!raw.includes(`npm:@supabase/supabase-js@2.50.0`)) {
        throw new Error(
          `${desc.path}: must pin @supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (/["']npm:@supabase\/supabase-js@2["']/.test(raw)) {
        throw new Error(`${desc.path}: broad npm:@supabase/supabase-js@2 pin must be absent`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*supabaseUrl\s*,\s*anonKey/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(supabaseUrl, anonKey, ...)`,
      );

      const serviceCtorMatches =
        handler.match(/createClient\(\s*supabaseUrl\s*,\s*serviceRoleKey/g) ?? [];
      assertEquals(
        serviceCtorMatches.length,
        1,
        `${desc.path}: expected exactly one service-role createClient(supabaseUrl, serviceRoleKey)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*supabaseUrl\s*,\s*anonKey/,
      );
      const serviceRoleIdx = handler.search(
        /createClient\(\s*supabaseUrl\s*,\s*serviceRoleKey/,
      );
      const getClaimsIdx = handler.indexOf("userClient.auth.getClaims(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const taskIdsIdx = handler.indexOf("body.task_ids");
      const messageIdx = handler.indexOf("body.message");
      const callerProfileIdx = handler.indexOf(`.from("profiles")`);
      const firstFromIdx = handler.search(/\.\s*from\(/);
      const firstRpcIdx = handler.search(/\.\s*rpc\(/);
      const tasksReadIdx = handler.indexOf(`.from("tasks")`);
      const projectsReadIdx = handler.indexOf(`.from("projects")`);
      const phasesReadIdx = handler.indexOf(`.from("phases")`);
      const assignmentsReadIdx = handler.indexOf(`.from("task_assignments")`);
      const blockersReadIdx = handler.indexOf(`.from("blockers")`);
      const btpmDecryptIdx = handler.indexOf(`"btpm_decrypt"`);
      const pmAuthorityIdx = handler.indexOf(`"has_project_pm_authority"`);
      const renderIdx = handler.indexOf("renderBtpmEmail(");
      const sendTenantIdx = handler.indexOf("sendTenantEmail(");
      const snapshotIdx = handler.indexOf(`"record_object_email_snapshot"`);
      const bearerExtractIdx = handler.indexOf(`authHeader.replace("Bearer "`);

      const anchors = {
        guardIdx, callerClientIdx, serviceRoleIdx, getClaimsIdx, reqJsonIdx,
        taskIdsIdx, messageIdx, callerProfileIdx, firstFromIdx, firstRpcIdx,
        tasksReadIdx, projectsReadIdx, phasesReadIdx, assignmentsReadIdx,
        blockersReadIdx, btpmDecryptIdx, pmAuthorityIdx, renderIdx,
        sendTenantIdx, snapshotIdx, bearerExtractIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }

      const mustPrecede: Array<[string, number]> = [
        ["service-role construction", serviceRoleIdx],
        ["bearer-token extraction", bearerExtractIdx],
        ["userClient.auth.getClaims()", getClaimsIdx],
        ["req.json()", reqJsonIdx],
        ["task_ids extraction", taskIdsIdx],
        ["message extraction", messageIdx],
        ["caller-profile read", callerProfileIdx],
        ["first .from()", firstFromIdx],
        ["first .rpc()", firstRpcIdx],
        ["Task read", tasksReadIdx],
        ["Project read", projectsReadIdx],
        ["Phase read", phasesReadIdx],
        ["assignment read", assignmentsReadIdx],
        ["blocker read", blockersReadIdx],
        ["btpm_decrypt", btpmDecryptIdx],
        ["has_project_pm_authority", pmAuthorityIdx],
        ["renderBtpmEmail", renderIdx],
        ["sendTenantEmail", sendTenantIdx],
        ["record_object_email_snapshot", snapshotIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      if (!handler.includes(`error: "Invalid JSON body"`)) {
        throw new Error(`${desc.path}: invalid-JSON response must remain`);
      }
      if (/ALLOWED_KEYS\s*=\s*new\s+Set/.test(handler)) {
        throw new Error(`${desc.path}: strict extra-field allow-list must not be introduced`);
      }
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      if (!/MAX_TASKS\s*=\s*50/.test(raw)) {
        throw new Error(`${desc.path}: MAX_TASKS = 50 must remain`);
      }
      if (!/\.slice\(0,\s*2000\)/.test(handler)) {
        throw new Error(`${desc.path}: 2000-character message limit must remain`);
      }
      if (!/Array\.from\(\s*new\s+Set\(\s*rawIds\s*\)\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: duplicate task_id removal must remain`);
      }
      if (!/callerProfile\.is_active\s*!==\s*true/.test(handler)) {
        throw new Error(`${desc.path}: active-caller requirement must remain`);
      }
      if (!/status_\$\{st\}/.test(handler) && !handler.includes("`status_${st}`")) {
        throw new Error(`${desc.path}: completed/cancelled status filtering must remain`);
      }
      if (!handler.includes(`reason: "archived"`)) {
        throw new Error(`${desc.path}: archived filtering must remain`);
      }
      if (!/latestAssignmentByTask/.test(handler)) {
        throw new Error(`${desc.path}: latest-assignment selection must remain`);
      }
      if (
        !/has_project_pm_authority[\s\S]{0,200}_user_id:\s*userId[\s\S]{0,200}_project_id:\s*projectId/.test(handler)
      ) {
        throw new Error(`${desc.path}: Project-level PM authority arguments must remain`);
      }
      if (
        !/btpm_decrypt[\s\S]{0,200}_ciphertext:\s*ciphertext[\s\S]{0,200}_org_id:\s*orgId/.test(handler)
      ) {
        throw new Error(`${desc.path}: btpm_decrypt organization-scoped arguments must remain`);
      }
      if (!/groups\.set\(key,/.test(handler) || !/groups\.get\(key\)/.test(handler)) {
        throw new Error(`${desc.path}: grouping by assignee email must remain`);
      }
      if (/\b(cc|bcc)\s*:/i.test(handler)) {
        throw new Error(`${desc.path}: CC/BCC recipient support must not be introduced`);
      }
      if (!handler.includes(`emailType: "team_work_reminder"`)) {
        throw new Error(`${desc.path}: sendTenantEmail emailType must remain`);
      }
      if (!/eventKey\s*=\s*`team_work_reminder:/.test(handler)) {
        throw new Error(`${desc.path}: sendTenantEmail event key format must remain`);
      }
      if (!handler.includes(`reason: "send-team-work-reminders"`)) {
        throw new Error(`${desc.path}: sendTenantEmail reason must remain`);
      }
      if (!handler.includes(`functionName: "send-team-work-reminders"`)) {
        throw new Error(`${desc.path}: sendTenantEmail functionName must remain`);
      }
      if (!/metadata:\s*\{\s*task_count:/.test(handler)) {
        throw new Error(`${desc.path}: sendTenantEmail metadata must remain`);
      }

      if (/nodemailer/i.test(handler) || /graph\.microsoft\.com/i.test(handler)) {
        throw new Error(`${desc.path}: direct provider/Graph send must not be introduced`);
      }
      if (/smtp:\/\//i.test(handler) || /createTransport\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: direct SMTP transport must not be introduced`);
      }
      if (/SMTP_HOST|SMTP_USER|SMTP_PASS|SMTP_PORT/.test(handler)) {
        throw new Error(`${desc.path}: direct Tenant SMTP secret access must not be introduced`);
      }
      if (/\.from\(\s*["']email_payload_snapshots["']\s*\)/.test(handler)) {
        throw new Error(`${desc.path}: direct write to email_payload_snapshots must not be introduced`);
      }
    },
  );
}

Deno.test(
  "R4AH descriptor set contains exactly the team work reminder endpoint",
  () => {
    assertEquals(R4AH_ENDPOINTS.length, 1);
    assertEquals(
      R4AH_ENDPOINTS[0].path,
      "supabase/functions/send-team-work-reminders/index.ts",
    );
  },
);

Deno.test(
  "R4AH negative neighbor: send-object-email remains guarded and unchanged",
  async () => {
    const path = "supabase/functions/send-object-email/index.ts";
    const raw = await Deno.readTextFile(path);
    if (!raw.includes("assertBrowserSessionOnly")) {
      throw new Error(`${path}: must retain the browser-session guard`);
    }
    if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
      throw new Error(`${path}: must retain the guard import`);
    }
  },
);

Deno.test(
  "R4AH negative neighbor: send-test-email remains guarded and unchanged",
  async () => {
    const path = "supabase/functions/send-test-email/index.ts";
    const raw = await Deno.readTextFile(path);
    if (!raw.includes("assertBrowserSessionOnly")) {
      throw new Error(`${path}: must retain the browser-session guard`);
    }
    if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
      throw new Error(`${path}: must retain the guard import`);
    }
  },
);

// -----------------------------------------------------------------------------
// API-E Audit Remediation 1 — Guard Power BI Credential Lifecycle
// -----------------------------------------------------------------------------

interface ApiEAuditFix1EndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const API_E_AUDIT_FIX_1_ENDPOINTS: ApiEAuditFix1EndpointDescriptor[] = [
  {
    path: "supabase/functions/powerbi-reporting-credential-lifecycle/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of API_E_AUDIT_FIX_1_ENDPOINTS) {
  Deno.test(
    `API-E Audit Fix 1 endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }
      if (!raw.includes(`npm:@supabase/supabase-js@2.50.0`)) {
        throw new Error(
          `${desc.path}: must pin @supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (/["']npm:@supabase\/supabase-js@2["']/.test(raw)) {
        throw new Error(`${desc.path}: broad npm:@supabase/supabase-js@2 pin must be absent`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*SUPABASE_ANON_KEY/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(SUPABASE_URL, SUPABASE_ANON_KEY, ...)`,
      );

      const serviceCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*SUPABASE_SERVICE_ROLE_KEY/g) ?? [];
      assertEquals(
        serviceCtorMatches.length,
        1,
        `${desc.path}: expected exactly one service-role createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*secureJsonHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, secureJsonHeaders)`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*SUPABASE_ANON_KEY/,
      );
      const serviceRoleIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*SUPABASE_SERVICE_ROLE_KEY/,
      );
      const bearerExtractIdx = handler.indexOf(`authHeader.slice("Bearer "`);
      const getClaimsIdx = handler.indexOf("userClient.auth.getClaims(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const forbiddenLoopIdx = handler.indexOf("FORBIDDEN_BODY_KEYS");
      const tenantIdIdx = handler.indexOf("b.tenant_id");
      const actionIdx = handler.indexOf("b.action");
      const rpcIdx = handler.indexOf("service_manage_powerbi_reporting_identity");

      const anchors = {
        guardIdx, callerClientIdx, serviceRoleIdx, bearerExtractIdx,
        getClaimsIdx, reqJsonIdx, forbiddenLoopIdx, tenantIdIdx, actionIdx, rpcIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }
      const mustPrecede: Array<[string, number]> = [
        ["bearer-token extraction", bearerExtractIdx],
        ["userClient.auth.getClaims()", getClaimsIdx],
        ["req.json()", reqJsonIdx],
        ["forbidden-field inspection", forbiddenLoopIdx],
        ["tenant_id extraction", tenantIdIdx],
        ["action extraction", actionIdx],
        ["service-role construction", serviceRoleIdx],
        ["service_manage_powerbi_reporting_identity", rpcIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      // POST-only handling.
      if (!/req\.method\s*!==\s*"POST"/.test(handler)) {
        throw new Error(`${desc.path}: POST-only enforcement must remain`);
      }
      // No-store / private response posture.
      if (!raw.includes(`"Cache-Control": "no-store, private"`)) {
        throw new Error(`${desc.path}: Cache-Control no-store/private must remain`);
      }
      if (!raw.includes(`Pragma: "no-cache"`)) {
        throw new Error(`${desc.path}: Pragma no-cache must remain`);
      }

      // Forbidden field list preserved.
      for (
        const field of [
          "login_role_name",
          "role_name",
          "password",
          "one_time_password",
          "connection_string",
          "database_host",
          "project_ref",
          "mapping_state",
          "role_attributes",
        ]
      ) {
        if (!raw.includes(`"${field}"`)) {
          throw new Error(`${desc.path}: forbidden field ${field} must remain in FORBIDDEN_BODY_KEYS`);
        }
      }

      // Exact allowed actions.
      for (
        const action of [
          "provision",
          "rotate",
          "disable",
          "enable",
          "activate",
          "revoke",
        ]
      ) {
        if (!new RegExp(`"${action}"`).test(raw)) {
          throw new Error(`${desc.path}: allowed action ${action} must remain`);
        }
      }

      // UUID validation.
      if (!/UUID_RE/.test(handler) || !/UUID_RE\.test\(tenantId\)/.test(handler)) {
        throw new Error(`${desc.path}: UUID validation of tenant_id must remain`);
      }

      // Actor identity from verified claims.
      if (!/actorUserId\s*=\s*String\(claimsResp\.claims\.sub\)/.test(handler)) {
        throw new Error(`${desc.path}: actor user ID must come from authenticated claims`);
      }
      // RPC argument mapping.
      if (
        !/_tenant_id:\s*tenantId/.test(handler) ||
        !/_action:\s*action/.test(handler) ||
        !/_actor_user_id:\s*actorUserId/.test(handler)
      ) {
        throw new Error(`${desc.path}: RPC argument mapping must remain`);
      }

      // Forbidden authorities / request-derived identity.
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // No password / RPC result / body / authorization / connection logging.
      if (/console\.(log|info|warn|error|debug)/.test(handler)) {
        throw new Error(
          `${desc.path}: must not introduce console logging that could leak passwords, RPC results, bodies, or authorization headers`,
        );
      }
    },
  );
}

Deno.test(
  "API-E Audit Fix 1 descriptor set contains exactly the Power BI credential lifecycle endpoint",
  () => {
    assertEquals(API_E_AUDIT_FIX_1_ENDPOINTS.length, 1);
    assertEquals(
      API_E_AUDIT_FIX_1_ENDPOINTS[0].path,
      "supabase/functions/powerbi-reporting-credential-lifecycle/index.ts",
    );
  },
);


// -----------------------------------------------------------------------------
// API-E Audit Remediation 2 — Guard Decision Evidence AI Diagnostic
// -----------------------------------------------------------------------------

interface ApiEAuditFix2EndpointDescriptor {
  path: string;
  callerClientVar: string;
}

const API_E_AUDIT_FIX_2_ENDPOINTS: ApiEAuditFix2EndpointDescriptor[] = [
  {
    path: "supabase/functions/test-openai-decision-evidence-summary/index.ts",
    callerClientVar: "userClient",
  },
];

for (const desc of API_E_AUDIT_FIX_2_ENDPOINTS) {
  Deno.test(
    `API-E Audit Fix 2 endpoint ${desc.path} integrates the browser-only guard correctly`,
    async () => {
      const raw = await Deno.readTextFile(desc.path);
      const src = stripComments(raw);

      if (!raw.includes(`from "../_shared/btpm-api/assertBrowserSessionOnly.ts"`)) {
        throw new Error(`${desc.path}: missing assertBrowserSessionOnly import`);
      }
      if (!raw.includes(`createSupabaseTokenVerifier`)) {
        throw new Error(`${desc.path}: missing createSupabaseTokenVerifier import`);
      }
      if (!raw.includes(`toSafeErrorResponse`)) {
        throw new Error(`${desc.path}: missing toSafeErrorResponse import`);
      }
      if (!raw.includes(`npm:@supabase/supabase-js@2.50.0`)) {
        throw new Error(
          `${desc.path}: must pin npm:@supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
        );
      }
      if (/https:\/\/esm\.sh\/@supabase\/supabase-js/.test(raw)) {
        throw new Error(`${desc.path}: legacy esm.sh Supabase import must be absent`);
      }

      const serveIdx = src.indexOf("Deno.serve");
      if (serveIdx < 0) throw new Error(`${desc.path}: Deno.serve entrypoint not found`);
      const handler = src.slice(serveIdx);

      const guardCalls = handler.match(/assertBrowserSessionOnly\s*\(/g) ?? [];
      assertEquals(guardCalls.length, 1, `${desc.path}: expected exactly one guard call`);

      const callerCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*SUPABASE_ANON_KEY/g) ?? [];
      assertEquals(
        callerCtorMatches.length,
        1,
        `${desc.path}: expected exactly one caller-scoped createClient(SUPABASE_URL, SUPABASE_ANON_KEY, ...)`,
      );

      const serviceCtorMatches =
        handler.match(/createClient\(\s*SUPABASE_URL\s*,\s*SERVICE_ROLE/g) ?? [];
      assertEquals(
        serviceCtorMatches.length,
        1,
        `${desc.path}: expected exactly one service-role createClient(SUPABASE_URL, SERVICE_ROLE)`,
      );

      const verifierPattern = new RegExp(
        `createSupabaseTokenVerifier\\(\\s*${desc.callerClientVar}\\s*\\)`,
      );
      if (!verifierPattern.test(handler)) {
        throw new Error(
          `${desc.path}: guard must call createSupabaseTokenVerifier(${desc.callerClientVar})`,
        );
      }
      if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must call toSafeErrorResponse(guardError, corsHeaders)`,
        );
      }
      if (/toSafeErrorResponse\(\s*guardError\s*\)/.test(handler)) {
        throw new Error(
          `${desc.path}: guard error path must not call the one-argument helper`,
        );
      }

      const guardIdx = handler.indexOf("assertBrowserSessionOnly(");
      const callerClientIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*SUPABASE_ANON_KEY/,
      );
      const serviceRoleIdx = handler.search(
        /createClient\(\s*SUPABASE_URL\s*,\s*SERVICE_ROLE/,
      );
      const getUserIdx = handler.indexOf("userClient.auth.getUser(");
      const reqJsonIdx = handler.indexOf("req.json(");
      const recordIdIdx = handler.indexOf("body?.recordId");
      const governanceRecordIdx = handler.indexOf('"governance_records"');
      const isOrgAdminIdx = handler.indexOf('"is_org_admin"');
      const aiFeatureSettingsIdx = handler.indexOf('"ai_feature_settings"');
      const tenantAiRuntimeIdx = handler.indexOf("resolveTenantAiTextRuntime(");
      const evidenceRpcIdx = handler.indexOf('"list_governance_record_evidence_files"');
      const graphResolveIdx = handler.indexOf("resolveAndAcquireTenantMicrosoftGraph(");
      const graphDownloadIdx = handler.indexOf("downloadMicrosoftGraphDriveItemBytes(");
      const bytesToBase64Idx = handler.indexOf("bytesToBase64(");
      const executeAiIdx = handler.indexOf("executeTenantAiResponse(");
      const optionsIdx = handler.indexOf('req.method === "OPTIONS"');

      const anchors = {
        guardIdx, callerClientIdx, serviceRoleIdx, getUserIdx, reqJsonIdx,
        recordIdIdx, governanceRecordIdx, isOrgAdminIdx, aiFeatureSettingsIdx,
        tenantAiRuntimeIdx, evidenceRpcIdx, graphResolveIdx, graphDownloadIdx,
        bytesToBase64Idx, executeAiIdx, optionsIdx,
      };
      for (const [k, v] of Object.entries(anchors)) {
        if (v < 0) throw new Error(`${desc.path}: anchor ${k} missing`);
      }

      if (guardIdx <= callerClientIdx) {
        throw new Error(
          `${desc.path}: guard must follow caller-scoped ${desc.callerClientVar} construction`,
        );
      }
      const mustPrecede: Array<[string, number]> = [
        ["service-role construction", serviceRoleIdx],
        ["userClient.auth.getUser()", getUserIdx],
        ["req.json()", reqJsonIdx],
        ["recordId extraction", recordIdIdx],
        ["governance_records read", governanceRecordIdx],
        ["is_org_admin RPC", isOrgAdminIdx],
        ["ai_feature_settings read", aiFeatureSettingsIdx],
        ["resolveTenantAiTextRuntime", tenantAiRuntimeIdx],
        ["evidence RPC", evidenceRpcIdx],
        ["resolveAndAcquireTenantMicrosoftGraph", graphResolveIdx],
        ["downloadMicrosoftGraphDriveItemBytes", graphDownloadIdx],
        ["bytesToBase64", bytesToBase64Idx],
        ["executeTenantAiResponse", executeAiIdx],
      ];
      for (const [label, idx] of mustPrecede) {
        if (guardIdx >= idx) {
          throw new Error(`${desc.path}: guard must precede ${label}`);
        }
      }
      if (guardIdx <= optionsIdx) {
        throw new Error(`${desc.path}: guard must come after OPTIONS branch`);
      }

      const reqJsonCalls = handler.match(/req\.json\s*\(/g) ?? [];
      assertEquals(reqJsonCalls.length, 1, `${desc.path}: exactly one req.json() call expected`);

      // POST-only + OPTIONS handling.
      if (!/req\.method\s*!==\s*"POST"/.test(handler)) {
        throw new Error(`${desc.path}: POST-only enforcement must remain`);
      }

      // Malformed-body fallback preserved.
      if (!/req\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)/.test(handler)) {
        throw new Error(`${desc.path}: permissive req.json().catch(() => ({})) must remain`);
      }

      // Decision Case record-kind enforcement.
      if (!raw.includes(`"decision_case"`)) {
        throw new Error(`${desc.path}: decision_case record-kind enforcement must remain`);
      }

      // Authoritative Organization resolution through Project.
      if (!/projects:project_id\(organization_id\)/.test(raw)) {
        throw new Error(`${desc.path}: authoritative Organization resolution must remain`);
      }

      // Exact is_org_admin argument mapping.
      if (
        !/_user_id:\s*userId/.test(handler) ||
        !/_organization_id:\s*orgId/.test(handler)
      ) {
        throw new Error(`${desc.path}: is_org_admin argument mapping must remain`);
      }

      // AI feature setting controls.
      if (!raw.includes(`"decision_cases"`)) {
        throw new Error(`${desc.path}: feature_key='decision_cases' must remain`);
      }
      if (!/model_source:\s*"admin_setting"/.test(raw)) {
        throw new Error(`${desc.path}: model_source='admin_setting' must remain`);
      }

      // File-limit defaults.
      if (!/DEFAULT_MAX_FILES\s*=\s*5\b/.test(raw)) {
        throw new Error(`${desc.path}: DEFAULT_MAX_FILES must remain 5`);
      }
      if (!/DEFAULT_MAX_INDIVIDUAL_MB\s*=\s*10\b/.test(raw)) {
        throw new Error(`${desc.path}: DEFAULT_MAX_INDIVIDUAL_MB must remain 10`);
      }
      if (!/DEFAULT_MAX_TOTAL_MB\s*=\s*25\b/.test(raw)) {
        throw new Error(`${desc.path}: DEFAULT_MAX_TOTAL_MB must remain 25`);
      }

      // Tenant AI runtime function name, reason, action.
      if (!raw.includes(`functionName: "test-openai-decision-evidence-summary"`)) {
        throw new Error(`${desc.path}: Tenant AI functionName must remain`);
      }
      if (!raw.includes(`reason: "decision-case-ai-diagnostic"`)) {
        throw new Error(`${desc.path}: Tenant AI reason must remain`);
      }
      if (!raw.includes(`action: "external_api_write"`)) {
        throw new Error(`${desc.path}: Tenant AI action must remain`);
      }

      // Evidence RPC arguments preserved.
      if (
        !/_record_id:\s*recordId/.test(handler) ||
        !/_include_archived:\s*false/.test(handler)
      ) {
        throw new Error(`${desc.path}: evidence RPC arguments must remain`);
      }

      // Graph reason preserved.
      if (!raw.includes(`reason: "decision-case-evidence-diagnostic-read"`)) {
        throw new Error(`${desc.path}: Graph reason must remain`);
      }
      if (!raw.includes(`operation: "download_decision_case_evidence"`)) {
        throw new Error(`${desc.path}: Graph download operation must remain`);
      }

      // All file-result statuses preserved.
      for (
        const status of [
          "sent",
          "unsupported_file_type",
          "file_too_large",
          "total_size_limit_exceeded",
          "missing_identifiers",
          "graph_token_unavailable",
          "download_failed",
          "model_does_not_support_image_input",
        ]
      ) {
        if (!raw.includes(`"${status}"`)) {
          throw new Error(`${desc.path}: file-result status ${status} must remain`);
        }
      }

      // Forbidden authorities / request-derived identity.
      if (/authenticateApiRequest\s*\(/.test(handler)) {
        throw new Error(`${desc.path}: must not call authenticateApiRequest`);
      }
      for (const forgedHeader of ["X-BTPM-Client-ID", "x-btpm-client-id", "x-client-id"]) {
        if (
          new RegExp(`headers\\.get\\(\\s*["']${forgedHeader}["']`, "i").test(handler)
        ) {
          throw new Error(`${desc.path}: must not read forged client header ${forgedHeader}`);
        }
      }
      if (
        /body\??\.client_id/i.test(handler) ||
        /searchParams\.get\(\s*["']client_id["']/i.test(handler)
      ) {
        throw new Error(
          `${desc.path}: must not derive client identity from request-controlled sources`,
        );
      }

      // No persistence of evidence bytes / payload / summary.
      if (/from\(\s*["']governance_evidence_files["']\s*\)\s*\.insert/.test(handler)) {
        throw new Error(`${desc.path}: must not persist evidence bytes`);
      }
      if (/from\(\s*["']ai_[^"']*["']\s*\)\s*\.insert/.test(handler)) {
        throw new Error(`${desc.path}: must not persist AI payloads or summaries`);
      }

      // No direct provider credential or Graph token acquirer.
      if (/OPENAI_API_KEY|AZURE_OPENAI_API_KEY|M365_CLIENT_SECRET/.test(handler)) {
        throw new Error(`${desc.path}: must not read direct provider or Graph credentials`);
      }
    },
  );
}

Deno.test(
  "API-E Audit Fix 2 descriptor set contains exactly the Decision Case evidence diagnostic endpoint",
  () => {
    assertEquals(API_E_AUDIT_FIX_2_ENDPOINTS.length, 1);
    assertEquals(
      API_E_AUDIT_FIX_2_ENDPOINTS[0].path,
      "supabase/functions/test-openai-decision-evidence-summary/index.ts",
    );
  },
);


Deno.test("combined guarded endpoint inventory contains exactly the fifty-seven locked endpoints", () => {

  const combined = [
    ...ENDPOINTS,
    ...R4B_ENDPOINTS.map((d) => d.path),
    ...R4C_ENDPOINTS.map((d) => d.path),
    ...R4D_ENDPOINTS.map((d) => d.path),
    ...R4E_ENDPOINTS.map((d) => d.path),
    ...R4F_ENDPOINTS.map((d) => d.path),
    ...R4G_ENDPOINTS.map((d) => d.path),
    ...R4H_ENDPOINTS.map((d) => d.path),
    ...R4I_ENDPOINTS.map((d) => d.path),
    ...R4J_ENDPOINTS.map((d) => d.path),
    ...R4K_ENDPOINTS.map((d) => d.path),
    ...R4L_ENDPOINTS.map((d) => d.path),
    ...R4M_ENDPOINTS.map((d) => d.path),
    ...R4N_ENDPOINTS.map((d) => d.path),
    ...R4O_ENDPOINTS.map((d) => d.path),
    ...R4P_ENDPOINTS.map((d) => d.path),
    ...R4Q_ENDPOINTS.map((d) => d.path),
    ...R4R_ENDPOINTS.map((d) => d.path),
    ...R4S_ENDPOINTS.map((d) => d.path),
    ...R4T_ENDPOINTS.map((d) => d.path),
    ...R4U_ENDPOINTS.map((d) => d.path),
    ...R4V_ENDPOINTS.map((d) => d.path),
    ...R4W_ENDPOINTS.map((d) => d.path),
    ...R4X_ENDPOINTS.map((d) => d.path),
    ...R4Y_ENDPOINTS.map((d) => d.path),
    ...R4Z_ENDPOINTS.map((d) => d.path),
    ...R4AA_ENDPOINTS.map((d) => d.path),
    ...R4AB_ENDPOINTS.map((d) => d.path),
    ...R4AC_ENDPOINTS.map((d) => d.path),
    ...R4AD_ENDPOINTS.map((d) => d.path),
    ...R4AE_ENDPOINTS.map((d) => d.path),
    ...R4AF_ENDPOINTS.map((d) => d.path),
    ...R4AG_ENDPOINTS.map((d) => d.path),
    ...R4AH_ENDPOINTS.map((d) => d.path),
    ...API_E_AUDIT_FIX_1_ENDPOINTS.map((d) => d.path),
    ...API_E_AUDIT_FIX_2_ENDPOINTS.map((d) => d.path),
  ].sort();
  assertEquals(combined, [
    "supabase/functions/admin-delete-user/index.ts",
    "supabase/functions/admin-users/index.ts",
    "supabase/functions/ai-guide-v2-chat/index.ts",
    "supabase/functions/ai-guide-v2-reindex/index.ts",
    "supabase/functions/ai-guide-v2-smoke/index.ts",
    "supabase/functions/ai-guide-v2-trace/index.ts",
    "supabase/functions/ai-help-chat/index.ts",
    "supabase/functions/azure-openai-test-connection/index.ts",
    "supabase/functions/browse-governance-decision-sharepoint-files/index.ts",
    "supabase/functions/btpm-import-commit/index.ts",
    "supabase/functions/btpm-import-dry-run/index.ts",
    "supabase/functions/build-kpi-app-payload/index.ts",
    "supabase/functions/capture-kpi-snapshot/index.ts",
    "supabase/functions/create-project-lessons-learned-document/index.ts",
    "supabase/functions/evaluate-kpi-schedule-policies/index.ts",
    "supabase/functions/export-kpi-automation-protocol/index.ts",
    "supabase/functions/generate-decision-case-ai-brief/index.ts",
    "supabase/functions/generate-decision-case-data-package-bundle/index.ts",
    "supabase/functions/generate-decision-case-data-package/index.ts",
    "supabase/functions/generate-decision-case-ppt-onepager/index.ts",
    "supabase/functions/generate-decision-case-word-brief/index.ts",
    "supabase/functions/generate-project-charter/index.ts",
    "supabase/functions/generate-project-closure-report/index.ts",
    "supabase/functions/generate-project-status-deck/index.ts",
    "supabase/functions/generate-roadmap-status-deck/index.ts",
    "supabase/functions/generate-roadmap-story-presentation/index.ts",
    "supabase/functions/generate-roadmap-story/index.ts",
    "supabase/functions/get-decision-case-data-package-bundle-download-url/index.ts",
    "supabase/functions/get-kpi-app-system-email/index.ts",
    "supabase/functions/invite-user/index.ts",
    "supabase/functions/lifecycle-hard-delete/index.ts",
    "supabase/functions/m365-ppt-readiness-check/index.ts",
    "supabase/functions/microsoft-graph-test-connection/index.ts",
    "supabase/functions/openai-test-connection/index.ts",
    "supabase/functions/poll-decision-case-ai-brief/index.ts",
    "supabase/functions/poll-roadmap-story-presentation/index.ts",
    "supabase/functions/poll-roadmap-story/index.ts",
    "supabase/functions/powerbi-reporting-credential-lifecycle/index.ts",
    "supabase/functions/prepare-kpi-app-report-now/index.ts",
    "supabase/functions/publish-roadmap-story-presentation/index.ts",
    "supabase/functions/read-kpi-app-catalog/index.ts",
    "supabase/functions/read-kpi-app-dimensions/index.ts",
    "supabase/functions/reconcile-kpi-app-submission/index.ts",
    "supabase/functions/redeem-invitations/index.ts",
    "supabase/functions/refresh-project-lessons-learned-document-metadata/index.ts",
    "supabase/functions/retry-kpi-app-submission/index.ts",
    "supabase/functions/run-kpi-app-scheduler/index.ts",
    "supabase/functions/run-kpi-snapshot-capture-scheduler/index.ts",
    "supabase/functions/select-governance-decision-sharepoint-evidence-files/index.ts",
    "supabase/functions/send-object-email/index.ts",
    "supabase/functions/send-team-work-reminders/index.ts",
    "supabase/functions/send-test-email/index.ts",
    "supabase/functions/sharepoint-files/index.ts",
    "supabase/functions/sharepoint-test-connection/index.ts",
    "supabase/functions/sharepoint-validate/index.ts",
    "supabase/functions/submit-kpi-app-payload/index.ts",
    "supabase/functions/test-openai-decision-evidence-summary/index.ts",
  ]);
  assertEquals(combined.length, 57);
});

// -----------------------------------------------------------------------------
// API-E Audit Remediation 3 — process-notifications worker-only authentication.
// Separate descriptor: NOT part of the combined browser-guard inventory.
// -----------------------------------------------------------------------------

const API_E_AUDIT_FIX_3_WORKER_ENDPOINTS = [
  "supabase/functions/process-notifications/index.ts",
];

Deno.test(
  "audit-fix-3 worker endpoint is NOT in the combined browser inventory",
  () => {
    const combined = [
      ...ENDPOINTS,
      ...R4B_ENDPOINTS.map((d) => d.path),
      ...R4C_ENDPOINTS.map((d) => d.path),
      ...R4D_ENDPOINTS.map((d) => d.path),
      ...R4E_ENDPOINTS.map((d) => d.path),
      ...R4F_ENDPOINTS.map((d) => d.path),
      ...R4G_ENDPOINTS.map((d) => d.path),
      ...R4H_ENDPOINTS.map((d) => d.path),
      ...R4I_ENDPOINTS.map((d) => d.path),
      ...R4J_ENDPOINTS.map((d) => d.path),
      ...R4K_ENDPOINTS.map((d) => d.path),
      ...R4L_ENDPOINTS.map((d) => d.path),
      ...R4M_ENDPOINTS.map((d) => d.path),
      ...R4N_ENDPOINTS.map((d) => d.path),
      ...R4O_ENDPOINTS.map((d) => d.path),
      ...R4P_ENDPOINTS.map((d) => d.path),
      ...R4Q_ENDPOINTS.map((d) => d.path),
      ...R4R_ENDPOINTS.map((d) => d.path),
      ...R4S_ENDPOINTS.map((d) => d.path),
      ...R4T_ENDPOINTS.map((d) => d.path),
      ...R4U_ENDPOINTS.map((d) => d.path),
      ...R4V_ENDPOINTS.map((d) => d.path),
      ...R4W_ENDPOINTS.map((d) => d.path),
      ...R4X_ENDPOINTS.map((d) => d.path),
      ...R4Y_ENDPOINTS.map((d) => d.path),
      ...R4Z_ENDPOINTS.map((d) => d.path),
      ...R4AA_ENDPOINTS.map((d) => d.path),
      ...R4AB_ENDPOINTS.map((d) => d.path),
      ...R4AC_ENDPOINTS.map((d) => d.path),
      ...R4AD_ENDPOINTS.map((d) => d.path),
      ...R4AE_ENDPOINTS.map((d) => d.path),
      ...R4AF_ENDPOINTS.map((d) => d.path),
      ...R4AG_ENDPOINTS.map((d) => d.path),
      ...R4AH_ENDPOINTS.map((d) => d.path),
      ...API_E_AUDIT_FIX_1_ENDPOINTS.map((d) => d.path),
      ...API_E_AUDIT_FIX_2_ENDPOINTS.map((d) => d.path),
    ];
    assertEquals(combined.length, 57);
    for (const workerPath of API_E_AUDIT_FIX_3_WORKER_ENDPOINTS) {
      if (combined.includes(workerPath)) {
        throw new Error(
          `${workerPath}: worker endpoint must not appear in the combined browser inventory`,
        );
      }
    }
  },
);

for (const workerPath of API_E_AUDIT_FIX_3_WORKER_ENDPOINTS) {
  Deno.test(
    `audit-fix-3 worker endpoint ${workerPath} enforces exact service-role authentication`,
    async () => {
      const raw = await Deno.readTextFile(workerPath);
      const src = stripComments(raw);

      // SDK pin — exact 2.50.0, no broad @2 pin.
      if (!raw.includes(`"npm:@supabase/supabase-js@2.50.0"`)) {
        throw new Error(`${workerPath}: must pin @supabase/supabase-js@2.50.0`);
      }
      if (/npm:@supabase\/supabase-js@2"/.test(raw)) {
        throw new Error(`${workerPath}: broad @2 pin must be absent`);
      }

      // No browser-session guard imports or calls.
      if (raw.includes("assertBrowserSessionOnly")) {
        throw new Error(`${workerPath}: must not use assertBrowserSessionOnly`);
      }
      if (raw.includes("createSupabaseTokenVerifier")) {
        throw new Error(`${workerPath}: must not use createSupabaseTokenVerifier`);
      }
      if (/authenticateApiRequest\s*\(/.test(src)) {
        throw new Error(`${workerPath}: must not call authenticateApiRequest`);
      }

      // No caller-scoped anon client / user JWT paths.
      if (/SUPABASE_ANON_KEY/.test(src)) {
        throw new Error(`${workerPath}: must not construct an anon client`);
      }
      if (/auth\.getUser\s*\(/.test(src)) {
        throw new Error(`${workerPath}: must not call auth.getUser`);
      }
      if (/auth\.getClaims\s*\(/.test(src)) {
        throw new Error(`${workerPath}: must not call auth.getClaims`);
      }

      // Exactly one service-role client construction.
      const clientCalls = src.match(/createClient\s*\(/g) ?? [];
      assertEquals(
        clientCalls.length,
        1,
        `${workerPath}: expected exactly one createClient call`,
      );

      // Worker credential is SUPABASE_SERVICE_ROLE_KEY (only).
      if (!/Deno\.env\.get\(\s*"SUPABASE_SERVICE_ROLE_KEY"\s*\)/.test(src)) {
        throw new Error(
          `${workerPath}: must read SUPABASE_SERVICE_ROLE_KEY as worker credential`,
        );
      }

      // Authorization bearer token extraction.
      if (!/req\.headers\.get\(\s*"Authorization"\s*\)/.test(src)) {
        throw new Error(`${workerPath}: must read Authorization header`);
      }
      if (!/"Bearer "/.test(src)) {
        throw new Error(`${workerPath}: must accept 'Bearer <token>' form`);
      }

      // secureSecretEqual with SHA-256 digest and full-length loop.
      if (!/async function secureSecretEqual\s*\(/.test(src)) {
        throw new Error(`${workerPath}: must define secureSecretEqual`);
      }
      if (!/crypto\.subtle\.digest\(\s*"SHA-256"/.test(src)) {
        throw new Error(`${workerPath}: secureSecretEqual must use SHA-256 digests`);
      }
      if (!/i\s*<\s*providedBytes\.length/.test(src)) {
        throw new Error(
          `${workerPath}: digest comparison must iterate over the complete digest`,
        );
      }
      if (!/secureSecretEqual\s*\(/.test(src)) {
        throw new Error(`${workerPath}: must call secureSecretEqual`);
      }

      // No direct string equality on the secret.
      if (
        /providedToken\s*===\s*serviceRoleKey/.test(src) ||
        /serviceRoleKey\s*===\s*providedToken/.test(src) ||
        /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,80}===\s*/.test(src) &&
          !/secureSecretEqual/.test(src)
      ) {
        throw new Error(
          `${workerPath}: must not compare bearer to secret with string equality`,
        );
      }

      // Fixed 401 response is preserved.
      if (!/"Missing auth"/.test(src)) {
        throw new Error(`${workerPath}: must return fixed 'Missing auth' 401`);
      }

      // Ordering: secureSecretEqual must precede privileged operations.
      const compareIdx = src.indexOf("secureSecretEqual(providedToken");
      const createClientIdx = src.indexOf("createClient(supabaseUrl");
      const firstFromIdx = src.indexOf(".from(");
      const firstRpcIdx = src.indexOf(".rpc(");
      const outboxIdx = src.indexOf('"notification_outbox"');
      const isWsMemberIdx = src.indexOf('"is_workspace_member"');
      const decryptIdx = src.indexOf('"btpm_decrypt"');
      const sendIdx = src.indexOf("sendTenantEmail(");

      for (
        const [name, idx] of [
          ["createClient(supabaseUrl, serviceRoleKey)", createClientIdx],
          [".from()", firstFromIdx],
          [".rpc()", firstRpcIdx],
          ["notification_outbox", outboxIdx],
          ["is_workspace_member", isWsMemberIdx],
          ["btpm_decrypt", decryptIdx],
          ["sendTenantEmail", sendIdx],
        ] as const
      ) {
        if (idx < 0) {
          throw new Error(`${workerPath}: expected anchor missing: ${name}`);
        }
        if (compareIdx < 0 || compareIdx >= idx) {
          throw new Error(
            `${workerPath}: secureSecretEqual must precede ${name}`,
          );
        }
      }

      // No request body parsed anywhere in the handler.
      if (/req\.json\s*\(/.test(src) || /req\.text\s*\(/.test(src)) {
        throw new Error(`${workerPath}: must not parse a request body`);
      }

      // Worker credential must not come from query params or custom headers.
      const url = new RegExp(String.raw`new URL\(`).test(src);
      if (url && /searchParams[\s\S]{0,200}(token|secret|key)/i.test(src)) {
        throw new Error(
          `${workerPath}: must not accept credentials via query parameters`,
        );
      }
      for (
        const forbiddenHeader of [
          "x-client-id",
          "x-btpm-client-id",
          "X-BTPM-Client-ID",
          "x-worker-secret",
          "x-worker-token",
        ]
      ) {
        if (
          new RegExp(
            String.raw`headers\.get\(\s*["']${forbiddenHeader}["']`,
            "i",
          ).test(src)
        ) {
          throw new Error(
            `${workerPath}: must not accept credentials via header ${forbiddenHeader}`,
          );
        }
      }

      // Preserved worker constants.
      if (!/\.limit\(\s*20\s*\)/.test(src)) {
        throw new Error(`${workerPath}: pending batch limit must remain 20`);
      }
      if (!/retries\s*>=\s*3/.test(src)) {
        throw new Error(`${workerPath}: maximum retry count must remain 3`);
      }
      for (
        const skipped of [
          "skipped_duplicate",
          "skipped_non_production",
          "failed_configuration",
        ]
      ) {
        if (!src.includes(skipped)) {
          throw new Error(
            `${workerPath}: terminal skipped status ${skipped} must remain`,
          );
        }
      }

      // Tenant SMTP function name / reason unchanged.
      if (
        !/reason:\s*"process-notifications"/.test(src) ||
        !/functionName:\s*"process-notifications"/.test(src)
      ) {
        throw new Error(
          `${workerPath}: Tenant SMTP reason/functionName must remain 'process-notifications'`,
        );
      }

      // No direct SMTP or Microsoft Graph email sending introduced.
      if (/nodemailer/.test(src)) {
        throw new Error(`${workerPath}: must not import nodemailer directly`);
      }
      if (/graph\.microsoft\.com/.test(src)) {
        throw new Error(
          `${workerPath}: must not send email via Microsoft Graph`,
        );
      }
    },
  );
}









// ---------------------------------------------------------------------------
// API-E Audit Remediation 4 — Canonical Edge classification cross-contract.
//
// Static reconciliation between the combined browser-guard inventory built
// from all existing descriptor arrays above and the canonical manifest at
// docs/governance/api/evidence/API_E_REACHABLE_SURFACE_LOCK.json. This test
// fails when an endpoint is substituted while the count is preserved, when
// the manifest and guard inventory diverge, when a worker is accidentally
// added to the browser inventory, or when a browser diagnostic is moved
// into the non-user set.
// ---------------------------------------------------------------------------
const API_E_AUDIT_FIX_4_MANIFEST_URL = new URL(
  "../../../../../docs/governance/api/evidence/API_E_REACHABLE_SURFACE_LOCK.json",
  __BTPM_SRC_BASE__,
);

function apiEAuditFix4BuildCombinedGuardInventoryNames(): string[] {
  const combined = [
    ...ENDPOINTS,
    ...R4B_ENDPOINTS.map((d) => d.path),
    ...R4C_ENDPOINTS.map((d) => d.path),
    ...R4D_ENDPOINTS.map((d) => d.path),
    ...R4E_ENDPOINTS.map((d) => d.path),
    ...R4F_ENDPOINTS.map((d) => d.path),
    ...R4G_ENDPOINTS.map((d) => d.path),
    ...R4H_ENDPOINTS.map((d) => d.path),
    ...R4I_ENDPOINTS.map((d) => d.path),
    ...R4J_ENDPOINTS.map((d) => d.path),
    ...R4K_ENDPOINTS.map((d) => d.path),
    ...R4L_ENDPOINTS.map((d) => d.path),
    ...R4M_ENDPOINTS.map((d) => d.path),
    ...R4N_ENDPOINTS.map((d) => d.path),
    ...R4O_ENDPOINTS.map((d) => d.path),
    ...R4P_ENDPOINTS.map((d) => d.path),
    ...R4Q_ENDPOINTS.map((d) => d.path),
    ...R4R_ENDPOINTS.map((d) => d.path),
    ...R4S_ENDPOINTS.map((d) => d.path),
    ...R4T_ENDPOINTS.map((d) => d.path),
    ...R4U_ENDPOINTS.map((d) => d.path),
    ...R4V_ENDPOINTS.map((d) => d.path),
    ...R4W_ENDPOINTS.map((d) => d.path),
    ...R4X_ENDPOINTS.map((d) => d.path),
    ...R4Y_ENDPOINTS.map((d) => d.path),
    ...R4Z_ENDPOINTS.map((d) => d.path),
    ...R4AA_ENDPOINTS.map((d) => d.path),
    ...R4AB_ENDPOINTS.map((d) => d.path),
    ...R4AC_ENDPOINTS.map((d) => d.path),
    ...R4AD_ENDPOINTS.map((d) => d.path),
    ...R4AE_ENDPOINTS.map((d) => d.path),
    ...R4AF_ENDPOINTS.map((d) => d.path),
    ...R4AG_ENDPOINTS.map((d) => d.path),
    ...R4AH_ENDPOINTS.map((d) => d.path),
    ...API_E_AUDIT_FIX_1_ENDPOINTS.map((d) => d.path),
    ...API_E_AUDIT_FIX_2_ENDPOINTS.map((d) => d.path),
  ];
  const names = combined.map((p) => {
    const m = /^supabase\/functions\/([^/]+)\/index\.ts$/.exec(p);
    if (!m) {
      throw new Error(`unexpected descriptor path shape: ${p}`);
    }
    return m[1];
  });
  return [...names].sort();
}

Deno.test(
  "API-E Audit Fix 4: combined guard inventory exactly matches manifest user-session set",
  async () => {
    const guardNames = apiEAuditFix4BuildCombinedGuardInventoryNames();
    const raw = await Deno.readTextFile(API_E_AUDIT_FIX_4_MANIFEST_URL);
    const manifest = JSON.parse(raw) as {
      edge_functions_user_session: { count: number; names: string[] };
      edge_functions_non_user: {
        count: number;
        entries: Array<{ name: string; protection_category: string }>;
      };
    };
    const canonicalUserSession = manifest.edge_functions_user_session.names;

    assertEquals(guardNames.length, 57);
    assertEquals(manifest.edge_functions_user_session.count, 57);
    assertEquals(canonicalUserSession.length, 57);
    assertEquals(guardNames, canonicalUserSession);

    for (
      const required of [
        "ai-guide-v2-reindex",
        "ai-guide-v2-smoke",
        "ai-guide-v2-trace",
      ]
    ) {
      if (!guardNames.includes(required)) {
        throw new Error(
          `${required}: expected in combined browser-guard inventory`,
        );
      }
      if (!canonicalUserSession.includes(required)) {
        throw new Error(
          `${required}: expected in canonical manifest user-session set`,
        );
      }
    }

    for (
      const required of [
        "powerbi-reporting-credential-lifecycle",
        "test-openai-decision-evidence-summary",
      ]
    ) {
      if (!guardNames.includes(required)) {
        throw new Error(
          `${required}: audit-remediation endpoint missing from guard inventory`,
        );
      }
      if (!canonicalUserSession.includes(required)) {
        throw new Error(
          `${required}: audit-remediation endpoint missing from manifest`,
        );
      }
    }

    if (guardNames.includes("process-notifications")) {
      throw new Error(
        "process-notifications must NOT appear in the combined browser-guard inventory",
      );
    }
    if (canonicalUserSession.includes("process-notifications")) {
      throw new Error(
        "process-notifications must NOT appear in the manifest user-session set",
      );
    }

    const nonUser = manifest.edge_functions_non_user.entries;
    assertEquals(manifest.edge_functions_non_user.count, 5);
    assertEquals(nonUser.length, 5);
    assertEquals(nonUser, [
      {
        name: "btpm-api-v1",
        protection_category:
          "delegated OAuth API with gateway JWT and application authorization",
      },
      {
        name: "process-notifications",
        protection_category: "exact service-role bearer authentication",
      },
      {
        name: "run-kpi-app-scheduler-cron",
        protection_category: "scheduler shared-secret protection",
      },
      {
        name: "run-kpi-snapshot-capture-scheduler-cron",
        protection_category: "scheduler shared-secret protection",
      },
      {
        name: "send-password-reset",
        protection_category: "service-role-administered endpoint",
      },
    ]);

    const processNotifications = nonUser.find(
      (e) => e.name === "process-notifications",
    );
    if (
      !processNotifications ||
      processNotifications.protection_category !==
        "exact service-role bearer authentication"
    ) {
      throw new Error(
        "process-notifications must carry protection_category 'exact service-role bearer authentication'",
      );
    }

    // btpm-api-v1 cross-contract alignment: absent from browser guard inventory
    // and user-session set; present exactly once in the non-user set with the
    // exact delegated-OAuth protection category.
    if (guardNames.includes("btpm-api-v1")) {
      throw new Error(
        "btpm-api-v1 must NOT appear in the combined browser-guard inventory",
      );
    }
    if (canonicalUserSession.includes("btpm-api-v1")) {
      throw new Error(
        "btpm-api-v1 must NOT appear in the manifest user-session set",
      );
    }
    const btpmApiV1Entries = nonUser.filter((e) => e.name === "btpm-api-v1");
    assertEquals(btpmApiV1Entries.length, 1);
    assertEquals(
      btpmApiV1Entries[0].protection_category,
      "delegated OAuth API with gateway JWT and application authorization",
    );

    const union = new Set<string>([
      ...canonicalUserSession,
      ...nonUser.map((e) => e.name),
    ]);
    assertEquals(union.size, 62);
    assertEquals(
      canonicalUserSession.length + nonUser.length,
      62,
      "user-session and non-user sets must be disjoint and cover exactly 62 endpoints",
    );
  },
);

Deno.test(
  "API-E Audit Fix 5: sharepoint-validate uses the getClaims-compatible Supabase SDK pin",
  async () => {
    const path = "supabase/functions/sharepoint-validate/index.ts";
    const raw = await Deno.readTextFile(path);

    // 1. Exact SDK pin present.
    if (!raw.includes(`npm:@supabase/supabase-js@2.50.0`)) {
      throw new Error(
        `${path}: must pin npm:@supabase/supabase-js@2.50.0 because the browser-session verifier requires auth.getClaims()`,
      );
    }

    // 2. No esm.sh Supabase JS imports.
    if (/esm\.sh\/@supabase\/supabase-js/.test(raw)) {
      throw new Error(
        `${path}: must not import @supabase/supabase-js from esm.sh`,
      );
    }

    // 3. Old version absent.
    if (raw.includes("@supabase/supabase-js@2.45.0")) {
      throw new Error(`${path}: must not retain @supabase/supabase-js@2.45.0`);
    }

    // 4. Exactly one createClient import.
    const createClientImports = raw.match(
      /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*["'][^"']*@supabase\/supabase-js[^"']*["']/g,
    ) ?? [];
    assertEquals(
      createClientImports.length,
      1,
      `${path}: must have exactly one createClient Supabase JS import`,
    );

    // 5. Guard imports remain present.
    for (const needed of [
      `import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";`,
      `import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";`,
      `import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";`,
    ]) {
      if (!raw.includes(needed)) {
        throw new Error(`${path}: missing required guard import: ${needed}`);
      }
    }

    // 6. Exactly one browser-session guard call.
    const guardCalls = raw.match(/await\s+assertBrowserSessionOnly\s*\(/g) ?? [];
    assertEquals(
      guardCalls.length,
      1,
      `${path}: must have exactly one assertBrowserSessionOnly call`,
    );

    // 7. Verifier still uses the caller-scoped client.
    if (!/createSupabaseTokenVerifier\(\s*callerClient\s*\)/.test(raw)) {
      throw new Error(
        `${path}: createSupabaseTokenVerifier must be invoked with the caller-scoped client`,
      );
    }

    // 8. Guard rejection routes through toSafeErrorResponse(guardError, corsHeaders).
    if (!/toSafeErrorResponse\(\s*guardError\s*,\s*corsHeaders\s*\)/.test(raw)) {
      throw new Error(
        `${path}: guard rejection must call toSafeErrorResponse(guardError, corsHeaders)`,
      );
    }

    // 9. Combined browser-session inventory remains exactly 57.
    const guardNames = apiEAuditFix4BuildCombinedGuardInventoryNames();
    assertEquals(
      guardNames.length,
      57,
      "combined browser-session inventory must remain exactly 57 endpoints",
    );

    // 10. sharepoint-validate present in combined guarded inventory and canonical manifest.
    if (!guardNames.includes("sharepoint-validate")) {
      throw new Error(
        "sharepoint-validate must remain in the combined guarded inventory",
      );
    }

    const manifestRaw = await Deno.readTextFile(API_E_AUDIT_FIX_4_MANIFEST_URL);
    const manifest = JSON.parse(manifestRaw) as {
      edge_functions_user_session: { count: number; names: string[] };
    };
    if (
      !manifest.edge_functions_user_session.names.includes("sharepoint-validate")
    ) {
      throw new Error(
        "sharepoint-validate must remain in the canonical manifest user-session set",
      );
    }
  },
);
