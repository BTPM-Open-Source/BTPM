// Phase 4D.14A.6A — Microsoft Graph runtime resolver / transport / helpers
// pure-unit tests. No Supabase, Vault, or Microsoft calls.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyEnvironmentGateError,
  classifyGraphIntegrationLookup,
  classifyOrganizationLookup,
  isValidGuid,
  mapTenantSecretErrorToGraphCode,
  TenantMicrosoftGraphError,
  toSafeMicrosoftGraphPublicError,
} from "../../functions/_shared/tenantMicrosoftGraph.ts";
import {
  classifyProbeHttpStatus,
  classifyTokenHttpStatus,
  classifyTransportFailure,
  decodeJwtPayload,
  summarizeGraphTokenClaims,
} from "../../functions/_shared/microsoftGraphClient.ts";
import {
  classifyGraphProbe,
  classifyGraphResolverError,
  classifyGraphTokenTransport,
  evaluateGraphTestOutcome,
  GRAPH_TEST_ENTRIES,
} from "../../functions/_shared/microsoftGraphTestConnectionHelpers.ts";

// ---------- Resolver classifiers ----------

Deno.test("gate error: 42501 -> blocked; anything else -> unavailable", () => {
  assertEquals(classifyEnvironmentGateError({ code: "42501" }),
    "environment_action_blocked");
  assertEquals(classifyEnvironmentGateError({ code: "XX000" }),
    "configuration_unavailable");
  assertEquals(classifyEnvironmentGateError(null), "configuration_unavailable");
});

Deno.test("org lookup classifier splits infra vs not-found", () => {
  assertEquals(classifyOrganizationLookup(new Error("boom"), null),
    { ok: false, code: "configuration_unavailable" });
  assertEquals(classifyOrganizationLookup(null, null),
    { ok: false, code: "organization_not_found" });
  assertEquals(classifyOrganizationLookup(null, { tenant_id: "t1" }),
    { ok: true, tenantId: "t1" });
});

Deno.test("integration lookup: absent vs disabled vs enabled", () => {
  assertEquals(classifyGraphIntegrationLookup(new Error("x"), null),
    { ok: false, code: "configuration_unavailable" });
  assertEquals(classifyGraphIntegrationLookup(null, null),
    { ok: false, code: "integration_not_configured" });
  assertEquals(
    classifyGraphIntegrationLookup(null, { id: "i", is_enabled: false, status: "active" }),
    { ok: false, code: "integration_disabled" },
  );
  assertEquals(
    classifyGraphIntegrationLookup(null, { id: "i", is_enabled: true, status: "disabled" }),
    { ok: false, code: "integration_disabled" },
  );
  assertEquals(
    classifyGraphIntegrationLookup(null, { id: "i", is_enabled: true, status: "active" }),
    { ok: true, integrationId: "i" },
  );
});

Deno.test("mapTenantSecretErrorToGraphCode covers all", () => {
  assertEquals(mapTenantSecretErrorToGraphCode("blocked"), "secret_blocked");
  assertEquals(mapTenantSecretErrorToGraphCode("not_found"), "secret_missing");
  assertEquals(mapTenantSecretErrorToGraphCode("empty"), "secret_missing");
  assertEquals(mapTenantSecretErrorToGraphCode("malformed"),
    "configuration_unavailable");
  assertEquals(mapTenantSecretErrorToGraphCode("resolver_unavailable"),
    "configuration_unavailable");
});

Deno.test("isValidGuid enforces canonical GUID shape", () => {
  assertEquals(isValidGuid("00000000-0000-0000-0000-000000000000"), true);
  assertEquals(isValidGuid("not-a-guid"), false);
  assertEquals(isValidGuid(""), false);
  assertEquals(isValidGuid(undefined), false);
});

Deno.test("toSafeMicrosoftGraphPublicError never leaks internals", () => {
  const cases: Array<[unknown, string]> = [
    [new TenantMicrosoftGraphError("environment_action_blocked", "x"),
      "microsoft_graph_access_blocked"],
    [new TenantMicrosoftGraphError("secret_blocked", "x"),
      "microsoft_graph_access_blocked"],
    [new TenantMicrosoftGraphError("integration_not_configured", "x"),
      "microsoft_graph_not_configured"],
    [new TenantMicrosoftGraphError("integration_disabled", "x"),
      "microsoft_graph_not_configured"],
    [new TenantMicrosoftGraphError("secret_missing", "x"),
      "microsoft_graph_not_configured"],
    [new TenantMicrosoftGraphError("identifier_invalid", "x"),
      "microsoft_graph_configuration_invalid"],
    [new TenantMicrosoftGraphError("organization_not_found", "x"),
      "microsoft_graph_configuration_unavailable"],
    [new TenantMicrosoftGraphError("configuration_unavailable", "x"),
      "microsoft_graph_configuration_unavailable"],
    [new Error("random"), "microsoft_graph_configuration_unavailable"],
  ];
  for (const [err, expected] of cases) {
    assertEquals(toSafeMicrosoftGraphPublicError(err).error, expected);
  }
});

// ---------- Transport classifiers ----------

Deno.test("classifyTokenHttpStatus", () => {
  assertEquals(classifyTokenHttpStatus(200), "success");
  assertEquals(classifyTokenHttpStatus(400), "credential_rejected");
  assertEquals(classifyTokenHttpStatus(401), "credential_rejected");
  assertEquals(classifyTokenHttpStatus(403), "access_forbidden");
  assertEquals(classifyTokenHttpStatus(429), "rate_limited");
  assertEquals(classifyTokenHttpStatus(500), "provider_unavailable");
  assertEquals(classifyTokenHttpStatus(502), "provider_unavailable");
  assertEquals(classifyTokenHttpStatus(418), "provider_unavailable");
});

Deno.test("classifyProbeHttpStatus", () => {
  assertEquals(classifyProbeHttpStatus(200), "success");
  assertEquals(classifyProbeHttpStatus(301), "success");
  assertEquals(classifyProbeHttpStatus(401), "credential_rejected");
  assertEquals(classifyProbeHttpStatus(403), "access_forbidden");
  assertEquals(classifyProbeHttpStatus(429), "rate_limited");
  assertEquals(classifyProbeHttpStatus(500), "graph_api_unavailable");
});

Deno.test("classifyTransportFailure detects abort/timeout", () => {
  assertEquals(classifyTransportFailure({ name: "AbortError" }), "timeout");
  assertEquals(classifyTransportFailure({ name: "TimeoutError" }), "timeout");
  assertEquals(classifyTransportFailure(new Error("net")), "network_error");
  assertEquals(classifyTransportFailure(null), "network_error");
});

// ---------- JWT decoding and claim summarization ----------

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (s: string) => {
    const b = btoa(s);
    return b.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  };
  return `${enc("{}")}.${enc(JSON.stringify(payload))}.sig`;
}

Deno.test("decodeJwtPayload handles ok / malformed / bad json", () => {
  assertEquals(decodeJwtPayload(makeJwt({ a: 1 })), { a: 1 });
  assertEquals(decodeJwtPayload("not.a.jwt.parts"), null);
  assertEquals(decodeJwtPayload("only-two.parts"), null);
});

const runtime = {
  microsoftTenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
} as const;

Deno.test("claims: aud + tid + appid + roles => full match", () => {
  const c = summarizeGraphTokenClaims(
    {
      aud: "https://graph.microsoft.com",
      tid: runtime.microsoftTenantId,
      appid: runtime.clientId,
      roles: ["Sites.Read.All"],
    },
    runtime,
  );
  assertEquals(c.aud_is_graph_api, true);
  assertEquals(c.tenant_matches_config, true);
  assertEquals(c.client_matches_config, true);
  assertEquals(c.application_roles_present, true);
  assertEquals(c.application_roles_count, 1);
});

Deno.test("claims: azp accepted when appid absent", () => {
  const c = summarizeGraphTokenClaims(
    {
      aud: "00000003-0000-0000-c000-000000000000",
      tid: runtime.microsoftTenantId.toUpperCase(),
      azp: runtime.clientId.toUpperCase(),
      roles: ["Files.Read.All", "Sites.Read.All"],
    },
    runtime,
  );
  assertEquals(c.client_matches_config, true);
  assertEquals(c.application_roles_count, 2);
});

Deno.test("claims: wrong audience / tenant / client fail", () => {
  const bad = summarizeGraphTokenClaims(
    {
      aud: "https://vault.azure.net",
      tid: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      appid: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      roles: ["X"],
    },
    runtime,
  );
  assertEquals(bad.aud_is_graph_api, false);
  assertEquals(bad.tenant_matches_config, false);
  assertEquals(bad.client_matches_config, false);
});

Deno.test("claims: only scp (delegated) => no application roles", () => {
  const c = summarizeGraphTokenClaims(
    {
      aud: "https://graph.microsoft.com",
      tid: runtime.microsoftTenantId,
      appid: runtime.clientId,
      scp: "User.Read",
    },
    runtime,
  );
  assertEquals(c.application_roles_present, false);
  assertEquals(c.application_roles_count, 0);
});

Deno.test("claims: null payload => all false / 0", () => {
  const c = summarizeGraphTokenClaims(null, runtime);
  assertEquals(c.aud_is_graph_api, false);
  assertEquals(c.tenant_matches_config, false);
  assertEquals(c.client_matches_config, false);
  assertEquals(c.application_roles_present, false);
  assertEquals(c.application_roles_count, 0);
});

// ---------- Classification mappers ----------

Deno.test("classifyGraphTokenTransport covers all", () => {
  assertEquals(classifyGraphTokenTransport("success").classification,
    "connection_successful");
  assertEquals(classifyGraphTokenTransport("credential_rejected").classification,
    "credential_rejected");
  assertEquals(classifyGraphTokenTransport("access_forbidden").classification,
    "microsoft_graph_access_blocked");
  assertEquals(classifyGraphTokenTransport("rate_limited").classification,
    "microsoft_graph_rate_limited");
  assertEquals(classifyGraphTokenTransport("timeout").classification,
    "microsoft_graph_timeout");
  assertEquals(classifyGraphTokenTransport("network_error").classification,
    "microsoft_graph_unavailable");
  assertEquals(classifyGraphTokenTransport("provider_unavailable").classification,
    "microsoft_graph_unavailable");
  assertEquals(classifyGraphTokenTransport("token_response_invalid").classification,
    "microsoft_graph_response_invalid");
});

Deno.test("classifyGraphProbe covers all", () => {
  assertEquals(classifyGraphProbe("success").classification,
    "connection_successful");
  assertEquals(classifyGraphProbe("credential_rejected").classification,
    "credential_rejected");
  assertEquals(classifyGraphProbe("access_forbidden").classification,
    "microsoft_graph_access_blocked");
  assertEquals(classifyGraphProbe("rate_limited").classification,
    "microsoft_graph_rate_limited");
  assertEquals(classifyGraphProbe("timeout").classification,
    "microsoft_graph_timeout");
  assertEquals(classifyGraphProbe("network_error").classification,
    "microsoft_graph_unavailable");
  assertEquals(classifyGraphProbe("graph_api_unavailable").classification,
    "microsoft_graph_unavailable");
});

Deno.test("classifyGraphResolverError maps every code", () => {
  const map: Array<[string, string]> = [
    ["environment_action_blocked", "microsoft_graph_access_blocked"],
    ["secret_blocked", "microsoft_graph_access_blocked"],
    ["integration_not_configured", "microsoft_graph_not_configured"],
    ["integration_disabled", "microsoft_graph_not_configured"],
    ["secret_missing", "microsoft_graph_not_configured"],
    ["identifier_invalid", "microsoft_graph_configuration_invalid"],
    ["organization_context_missing", "microsoft_graph_unavailable"],
    ["organization_not_found", "microsoft_graph_unavailable"],
    ["configuration_unavailable", "microsoft_graph_unavailable"],
  ];
  for (const [code, expected] of map) {
    // deno-lint-ignore no-explicit-any
    const err = new TenantMicrosoftGraphError(code as any, "x");
    assertEquals(classifyGraphResolverError(err).classification, expected);
  }
  assertEquals(classifyGraphResolverError(new Error("x")).classification,
    "microsoft_graph_unavailable");
});

// ---------- Success contract ----------

const okClaims = {
  aud_is_graph_api: true,
  tenant_matches_config: true,
  client_matches_config: true,
  application_roles_present: true,
  application_roles_count: 1,
};

Deno.test("success requires token + claims + roles + probe reach", () => {
  const ok = evaluateGraphTestOutcome({
    tokenCategory: "success",
    claimChecks: okClaims,
    probeCategory: "success",
  });
  assertEquals(ok.classification, "connection_successful");
});

Deno.test("token failure short-circuits to transport classification", () => {
  const r = evaluateGraphTestOutcome({
    tokenCategory: "credential_rejected",
    claimChecks: {
      aud_is_graph_api: false,
      tenant_matches_config: false,
      client_matches_config: false,
      application_roles_present: false,
      application_roles_count: 0,
    },
    probeCategory: null,
  });
  assertEquals(r.classification, "credential_rejected");
});

Deno.test("wrong aud => token mismatch", () => {
  const r = evaluateGraphTestOutcome({
    tokenCategory: "success",
    claimChecks: { ...okClaims, aud_is_graph_api: false },
    probeCategory: "success",
  });
  assertEquals(r.classification, "microsoft_graph_token_mismatch");
});

Deno.test("wrong tenant/client => token mismatch", () => {
  assertEquals(
    evaluateGraphTestOutcome({
      tokenCategory: "success",
      claimChecks: { ...okClaims, tenant_matches_config: false },
      probeCategory: "success",
    }).classification,
    "microsoft_graph_token_mismatch",
  );
  assertEquals(
    evaluateGraphTestOutcome({
      tokenCategory: "success",
      claimChecks: { ...okClaims, client_matches_config: false },
      probeCategory: "success",
    }).classification,
    "microsoft_graph_token_mismatch",
  );
});

Deno.test("missing roles => application_permissions_missing", () => {
  const r = evaluateGraphTestOutcome({
    tokenCategory: "success",
    claimChecks: {
      ...okClaims,
      application_roles_present: false,
      application_roles_count: 0,
    },
    probeCategory: "success",
  });
  assertEquals(
    r.classification,
    "microsoft_graph_application_permissions_missing",
  );
});

Deno.test("probe failure surfaces from probe category", () => {
  const r = evaluateGraphTestOutcome({
    tokenCategory: "success",
    claimChecks: okClaims,
    probeCategory: "rate_limited",
  });
  assertEquals(r.classification, "microsoft_graph_rate_limited");
});

Deno.test("null probe when everything else ok => unavailable", () => {
  const r = evaluateGraphTestOutcome({
    tokenCategory: "success",
    claimChecks: okClaims,
    probeCategory: null,
  });
  assertEquals(r.classification, "microsoft_graph_unavailable");
});

// ---------- Recorder mapping shape ----------

Deno.test("recorder results for classifications", () => {
  assertEquals(GRAPH_TEST_ENTRIES.connection_successful.recorderResult, "success");
  assertEquals(GRAPH_TEST_ENTRIES.microsoft_graph_access_blocked.recorderResult, "blocked");
  assertEquals(GRAPH_TEST_ENTRIES.credential_rejected.recorderResult, "failure");
  assertEquals(GRAPH_TEST_ENTRIES.microsoft_graph_token_mismatch.recorderResult, "failure");
});
