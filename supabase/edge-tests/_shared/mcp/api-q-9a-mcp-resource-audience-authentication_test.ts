// API-Q.9A — MCP resource-audience authentication proof.
//
// Proves the ALREADY EXISTING BTPM token validator accepts the audience shape
// produced by the (still inert) Custom Access Token Hook:
//   aud = ["authenticated", BTPM_MCP_RESOURCE_URI]
// and still rejects a token whose audience is only ["authenticated"].
//
// The validator is NOT modified: `expectedAudience` remains the canonical MCP
// resource URI and is never weakened to "authenticated".

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authenticateMcpRequest } from "../../../functions/btpm-mcp/mcp/authenticateMcpRequest.ts";
import type {
  TokenContextDependencies,
  VerifiedTokenClaims,
} from "../../../functions/_shared/btpm-api/resolveTokenContext.ts";
import { ApiAuthenticationError } from "../../../functions/_shared/btpm-api/apiErrors.ts";

// Test-only values. Not a real deployment resource URI or client ID.
const RESOURCE_URI = "https://mcp.example.test/functions/v1/btpm-mcp";
const ISSUER = "https://auth.example.test/auth/v1";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "example-oauth-client";
const NOW = 1_800_000_000;

function request(): Request {
  return new Request("https://mcp.example.test/functions/v1/btpm-mcp", {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
  });
}

function deps(aud: string | string[]): TokenContextDependencies {
  const claims: VerifiedTokenClaims = {
    iss: ISSUER,
    aud,
    exp: NOW + 600,
    sub: USER_ID,
    client_id: CLIENT_ID,
    role: "authenticated",
  };
  return {
    tokenVerifier: { verify: () => Promise.resolve(claims) },
    currentUserResolver: { resolveCurrentUserId: () => Promise.resolve(USER_ID) },
    clock: { nowSeconds: () => NOW },
  };
}

const config = { expectedIssuer: ISSUER, resourceUri: RESOURCE_URI };

Deno.test("API-Q.9A accepts aud = [authenticated, MCP resource]", async () => {
  const context = await authenticateMcpRequest(
    request(),
    config,
    deps(["authenticated", RESOURCE_URI]),
    "req-1",
  );
  assertEquals(context.userId, USER_ID);
  assertEquals(context.clientId, CLIENT_ID);
  assertEquals(context.resourceUri, RESOURCE_URI);
  assert(context.audiences.includes("authenticated"));
  assert(context.audiences.includes(RESOURCE_URI));
});

Deno.test("API-Q.9A rejects aud = [authenticated] for MCP", async () => {
  const error = await assertRejects(
    () =>
      authenticateMcpRequest(request(), config, deps(["authenticated"]), "req-2"),
    ApiAuthenticationError,
  );
  assertEquals(error.code, "invalid_audience");
});

Deno.test("API-Q.9A rejects aud = authenticated string for MCP", async () => {
  await assertRejects(
    () =>
      authenticateMcpRequest(request(), config, deps("authenticated"), "req-3"),
    ApiAuthenticationError,
  );
});
