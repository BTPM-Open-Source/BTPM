// API-Q.CLAUDE-D1 — Safe MCP authentication-failure observability.
//
// Scope is deliberately narrow: it proves only the bounded diagnostic log shape
// emitted when `authenticateMcpRequest(...)` throws, and that the external HTTP
// 401 + WWW-Authenticate contract is unchanged.

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
import { buildMcpWwwAuthenticate } from "../../functions/btpm-mcp/mcp/oauthProtectedResource.ts";
import type { TokenContextDependencies } from "../../functions/_shared/btpm-api/resolveTokenContext.ts";
import type { ClientAuthorizationStore } from "../../functions/_shared/btpm-api/authorizeClient.ts";
import { neverInvokedMcpRuntimeInput } from "../_shared/mcp/support/neverInvokedMcpRuntimeInput.ts";

const SUPABASE_URL = "https://example.supabase.co";
const RESOURCE_URI = `${SUPABASE_URL}/functions/v1/btpm-mcp`;
const BEARER = "opaque-test-token";

/** Never invoked: authentication fails before any downstream dependency runs. */
const unused = () => Promise.reject(new Error("dependency must not be used"));

const AUTHORIZATION_STORE: ClientAuthorizationStore = {
  findActiveClientsByOauthClientId: unused,
  findActivePolicyVersionsForClient: unused,
  findUserAcknowledgement: unused,
};

function buildRuntime(tokenDependencies: TokenContextDependencies) {
  return createBtpmMcpRuntime(neverInvokedMcpRuntimeInput({
    resourceUri: RESOURCE_URI,
    supabaseUrl: SUPABASE_URL,
    tokenDependencies,
    authorizationStore: AUTHORIZATION_STORE,
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
  return new Request(`${RESOURCE_URI}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${BEARER}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

/**
 * Existing invariant path: verified claims whose audience is only
 * "authenticated" fail audience validation with `invalid_audience`.
 */
const AUDIENCE_FAILURE_DEPENDENCIES: TokenContextDependencies = {
  tokenVerifier: {
    verify: () =>
      Promise.resolve({
        iss: `${SUPABASE_URL}/auth/v1`,
        aud: "authenticated",
        exp: 2_000,
        sub: "user-123",
        client_id: "claude-oauth-client",
      }),
  },
  currentUserResolver: { resolveCurrentUserId: unused },
  clock: { nowSeconds: () => 1_000 },
};

/** A non-ApiAuthenticationError escaping the authentication boundary. */
const UNKNOWN_FAILURE_DEPENDENCIES: TokenContextDependencies = {
  tokenVerifier: {
    verify: () =>
      Promise.resolve({
        iss: `${SUPABASE_URL}/auth/v1`,
        aud: [RESOURCE_URI],
        exp: 2_000,
        sub: "user-123",
        client_id: "claude-oauth-client",
      }),
  },
  currentUserResolver: { resolveCurrentUserId: unused },
  clock: {
    nowSeconds: () => {
      throw new Error(`boom ${BEARER} sub=user-123`);
    },
  },
};

async function runWithCapturedWarnings(
  dependencies: TokenContextDependencies,
): Promise<{ response: Response; warnings: string[] }> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const response = await handleBtpmMcpRequest(
      mcpRequest(),
      buildRuntime(dependencies),
    );
    return { response, warnings };
  } finally {
    console.warn = originalWarn;
  }
}

async function assertBounded401(response: Response): Promise<void> {
  assertStrictEquals(response.status, 401);
  assertStrictEquals(
    response.headers.get("www-authenticate"),
    buildMcpWwwAuthenticate(RESOURCE_URI),
  );
  assertStrictEquals(
    response.headers.get("content-type"),
    "application/json",
  );
  const parsed = JSON.parse(await response.text()) as Record<string, unknown>;
  assertStrictEquals(parsed.error, "unauthorized");
  assertEquals(Object.keys(parsed).sort(), ["error", "message"]);
  assert(response.headers.get(BTPM_MCP_REQUEST_ID_HEADER) !== null);
}

function parseDiagnostic(warnings: string[]): Record<string, unknown> {
  assertStrictEquals(warnings.length, 1);
  return JSON.parse(warnings[0]) as Record<string, unknown>;
}

Deno.test("API-Q.CLAUDE-D1: ApiAuthenticationError logs its bounded code", async () => {
  const { response, warnings } = await runWithCapturedWarnings(
    AUDIENCE_FAILURE_DEPENDENCIES,
  );
  const entry = parseDiagnostic(warnings);
  assertStrictEquals(entry.event, "btpm_mcp_authentication_failed");
  assertStrictEquals(entry.code, "invalid_audience");
  assertEquals(Object.keys(entry).sort(), ["code", "event", "request_id"]);
  assertStrictEquals(
    entry.request_id,
    response.headers.get(BTPM_MCP_REQUEST_ID_HEADER),
  );
  await assertBounded401(response);
});

Deno.test("API-Q.CLAUDE-D1: unknown throw logs unknown_authentication_failure", async () => {
  const { response, warnings } = await runWithCapturedWarnings(
    UNKNOWN_FAILURE_DEPENDENCIES,
  );
  const entry = parseDiagnostic(warnings);
  assertStrictEquals(entry.event, "btpm_mcp_authentication_failed");
  assertStrictEquals(entry.code, "unknown_authentication_failure");
  assertEquals(Object.keys(entry).sort(), ["code", "event", "request_id"]);
  await assertBounded401(response);
});

Deno.test("API-Q.CLAUDE-D1: diagnostic log leaks no sensitive value", async () => {
  for (
    const dependencies of [
      AUDIENCE_FAILURE_DEPENDENCIES,
      UNKNOWN_FAILURE_DEPENDENCIES,
    ]
  ) {
    const { warnings } = await runWithCapturedWarnings(dependencies);
    const serialized = warnings.join("\n");
    for (
      const forbidden of [
        BEARER,
        "Bearer",
        "authorization",
        "claims",
        "user-123",
        "claude-oauth-client",
        RESOURCE_URI,
        SUPABASE_URL,
        "boom",
        "stack",
        "message",
        "cause",
        "internalCause",
        "tools/list",
      ]
    ) {
      assert(
        !serialized.includes(forbidden),
        `diagnostic log must not contain ${forbidden}: ${serialized}`,
      );
    }
  }
});
