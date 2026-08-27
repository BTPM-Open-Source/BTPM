// Phase 4D.14A.7A — SharePoint Tenant runtime resolver, transport, and
// helper pure-unit tests. No Supabase, Vault, or Microsoft calls.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyEnvironmentGateError,
  classifyOrganizationLookup,
  classifySharePointIntegrationLookup,
  isSupportedGraphSiteId,
  mapTenantSecretErrorToSharePointCode,
  parseAndNormalizeSharePointSiteUrl,
  TenantSharePointError,
  toSafeSharePointPublicError,
} from "../../functions/_shared/tenantSharePoint.ts";
import {
  classifyDrivesHttpStatus,
  classifySiteHttpStatus,
  listSharePointSiteDrives,
  resolveSharePointSiteById,
  resolveSharePointSiteByPath,
} from "../../functions/_shared/sharePointClient.ts";
import {
  classifyGraphDependencyPublicError,
  classifySharePointResolverError,
  classifySharePointTransport,
  evaluateSharePointTestOutcome,
  SHAREPOINT_TEST_ENTRIES,
} from "../../functions/_shared/sharePointTestConnectionHelpers.ts";

// ---------- Resolver classifiers ----------

Deno.test("gate error 42501 blocked; other unavailable", () => {
  assertEquals(classifyEnvironmentGateError({ code: "42501" }),
    "environment_action_blocked");
  assertEquals(classifyEnvironmentGateError({ code: "XX000" }),
    "configuration_unavailable");
  assertEquals(classifyEnvironmentGateError(null), "configuration_unavailable");
});

Deno.test("org lookup classifier", () => {
  assertEquals(classifyOrganizationLookup(new Error("x"), null),
    { ok: false, code: "configuration_unavailable" });
  assertEquals(classifyOrganizationLookup(null, null),
    { ok: false, code: "organization_not_found" });
  assertEquals(classifyOrganizationLookup(null, { tenant_id: "t1" }),
    { ok: true, tenantId: "t1" });
});

Deno.test("integration lookup: absent, disabled, active", () => {
  assertEquals(classifySharePointIntegrationLookup(null, null),
    { ok: false, code: "integration_not_configured" });
  assertEquals(
    classifySharePointIntegrationLookup(null, {
      id: "i", is_enabled: false, status: "active",
    }),
    { ok: false, code: "integration_disabled" },
  );
  assertEquals(
    classifySharePointIntegrationLookup(null, {
      id: "i", is_enabled: true, status: "active",
    }),
    { ok: true, integrationId: "i" },
  );
});

Deno.test("mapTenantSecretErrorToSharePointCode", () => {
  assertEquals(mapTenantSecretErrorToSharePointCode("blocked"), "secret_blocked");
  assertEquals(mapTenantSecretErrorToSharePointCode("not_found"), "secret_missing");
  assertEquals(mapTenantSecretErrorToSharePointCode("empty"), "secret_missing");
  assertEquals(mapTenantSecretErrorToSharePointCode("malformed"),
    "configuration_unavailable");
  assertEquals(mapTenantSecretErrorToSharePointCode("resolver_unavailable"),
    "configuration_unavailable");
});

// ---------- Site URL parsing ----------

Deno.test("site URL: valid https .sharepoint.com root accepted", () => {
  const r = parseAndNormalizeSharePointSiteUrl("https://contoso.sharepoint.com/");
  if (!r.ok) throw new Error("expected ok");
  assertEquals(r.value.hostname, "contoso.sharepoint.com");
  assertEquals(r.value.path, "");
  assertEquals(r.value.isRootSite, true);
  assertEquals(r.value.href, "https://contoso.sharepoint.com");
});

Deno.test("site URL: valid named site accepted", () => {
  const r = parseAndNormalizeSharePointSiteUrl("https://Contoso.SharePoint.com/sites/BTPM/");
  if (!r.ok) throw new Error("expected ok");
  assertEquals(r.value.hostname, "contoso.sharepoint.com");
  assertEquals(r.value.path, "/sites/BTPM");
  assertEquals(r.value.href, "https://contoso.sharepoint.com/sites/BTPM");
});

Deno.test("site URL: http rejected", () => {
  assertEquals(parseAndNormalizeSharePointSiteUrl("http://contoso.sharepoint.com"),
    { ok: false, code: "site_url_invalid" });
});

Deno.test("site URL: non-sharepoint host rejected", () => {
  assertEquals(parseAndNormalizeSharePointSiteUrl("https://contoso.example.com"),
    { ok: false, code: "site_url_invalid" });
});

Deno.test("site URL: embedded creds rejected", () => {
  assertEquals(parseAndNormalizeSharePointSiteUrl(
    "https://user:pw@contoso.sharepoint.com/sites/x"),
    { ok: false, code: "site_url_invalid" });
});

Deno.test("site URL: query/fragment rejected", () => {
  assertEquals(parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/sites/x?a=b"),
    { ok: false, code: "site_url_invalid" });
  assertEquals(parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/sites/x#f"),
    { ok: false, code: "site_url_invalid" });
});

Deno.test("site URL: arbitrary path rejected", () => {
  assertEquals(parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/foo/bar"),
    { ok: false, code: "site_url_invalid" });
});

Deno.test("site URL: empty/non-string rejected", () => {
  assertEquals(parseAndNormalizeSharePointSiteUrl(""),
    { ok: false, code: "site_url_invalid" });
  assertEquals(parseAndNormalizeSharePointSiteUrl(null),
    { ok: false, code: "site_url_invalid" });
});

// ---------- Site ID validation ----------

Deno.test("site ID: composite hostname,guid,guid accepted", () => {
  assertEquals(isSupportedGraphSiteId(
    "contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222"),
    true);
});

Deno.test("site ID: bare GUID accepted", () => {
  assertEquals(isSupportedGraphSiteId("11111111-1111-1111-1111-111111111111"), true);
});

Deno.test("site ID: bare hostname accepted", () => {
  assertEquals(isSupportedGraphSiteId("contoso.sharepoint.com"), true);
});

Deno.test("site ID: hostname,root accepted", () => {
  assertEquals(isSupportedGraphSiteId("contoso.sharepoint.com,root"), true);
});

Deno.test("site ID: PnP/opaque/arbitrary rejected", () => {
  assertEquals(isSupportedGraphSiteId("abc123def456"), false);
  assertEquals(isSupportedGraphSiteId("random text"), false);
  assertEquals(isSupportedGraphSiteId(""), false);
  assertEquals(isSupportedGraphSiteId(null), false);
  assertEquals(isSupportedGraphSiteId(
    "not-a-host,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222"),
    false);
});

// ---------- Safe public error mapping ----------

Deno.test("toSafeSharePointPublicError: blocked/invalid/missing/other", () => {
  assertEquals(
    toSafeSharePointPublicError(new TenantSharePointError("environment_action_blocked", "x")).error,
    "sharepoint_access_blocked");
  assertEquals(
    toSafeSharePointPublicError(new TenantSharePointError("site_url_invalid", "x")).error,
    "sharepoint_configuration_invalid");
  assertEquals(
    toSafeSharePointPublicError(new TenantSharePointError("secret_missing", "x")).error,
    "sharepoint_not_configured");
  assertEquals(toSafeSharePointPublicError(new Error("x")).error,
    "sharepoint_configuration_unavailable");
});

// ---------- Transport HTTP classification ----------

Deno.test("classifySiteHttpStatus mapping", () => {
  assertEquals(classifySiteHttpStatus(200), "success");
  assertEquals(classifySiteHttpStatus(401), "token_rejected");
  assertEquals(classifySiteHttpStatus(403), "permission_denied");
  assertEquals(classifySiteHttpStatus(404), "site_not_found");
  assertEquals(classifySiteHttpStatus(429), "rate_limited");
  assertEquals(classifySiteHttpStatus(500), "graph_unavailable");
});

Deno.test("classifyDrivesHttpStatus mapping", () => {
  assertEquals(classifyDrivesHttpStatus(200), "success");
  assertEquals(classifyDrivesHttpStatus(404), "libraries_not_found");
  assertEquals(classifyDrivesHttpStatus(401), "token_rejected");
  assertEquals(classifyDrivesHttpStatus(403), "permission_denied");
  assertEquals(classifyDrivesHttpStatus(429), "rate_limited");
  assertEquals(classifyDrivesHttpStatus(503), "graph_unavailable");
});


// ---------- Transport with mocked fetch ----------

function fakeJsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("resolveSharePointSiteByPath: success + match", async () => {
  const configured = parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/sites/BTPM");
  if (!configured.ok) throw new Error("bad config");
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (!url.startsWith("https://graph.microsoft.com/v1.0/sites/")) {
      throw new Error("wrong url");
    }
    return fakeJsonResp(200, {
      id: "contoso.sharepoint.com,gg,hh",
      webUrl: "https://contoso.sharepoint.com/sites/BTPM",
    });
  }) as unknown as typeof fetch;
  const r = await resolveSharePointSiteByPath({
    accessToken: "tok", requestId: "r1",
    configuredSiteUrl: configured.value, fetchImpl,
  });
  assertEquals(r.category, "success");
  assertEquals(r.site?.siteId, "contoso.sharepoint.com,gg,hh");
});

Deno.test("resolveSharePointSiteByPath: site mismatch", async () => {
  const configured = parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/sites/BTPM");
  if (!configured.ok) throw new Error("bad config");
  const fetchImpl = (async () => fakeJsonResp(200, {
    id: "x", webUrl: "https://contoso.sharepoint.com/sites/other",
  })) as unknown as typeof fetch;
  const r = await resolveSharePointSiteByPath({
    accessToken: "tok", requestId: "r1",
    configuredSiteUrl: configured.value, fetchImpl,
  });
  assertEquals(r.category, "site_mismatch");
});

Deno.test("resolveSharePointSiteById: 404 -> site_not_found", async () => {
  const configured = parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/sites/BTPM");
  if (!configured.ok) throw new Error("bad config");
  const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
  const r = await resolveSharePointSiteById({
    accessToken: "tok", requestId: "r1",
    siteId: "contoso.sharepoint.com,aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    configuredSiteUrl: configured.value, fetchImpl,
  });
  assertEquals(r.category, "site_not_found");
});

Deno.test("resolveSharePointSiteByPath: malformed json -> response_invalid", async () => {
  const configured = parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com");
  if (!configured.ok) throw new Error("bad config");
  const fetchImpl = (async () => new Response("not json", {
    status: 200, headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch;
  const r = await resolveSharePointSiteByPath({
    accessToken: "tok", requestId: "r1",
    configuredSiteUrl: configured.value, fetchImpl,
  });
  assertEquals(r.category, "response_invalid");
});

Deno.test("listSharePointSiteDrives: multiple libraries success", async () => {
  const fetchImpl = (async () => fakeJsonResp(200, {
    value: [{ id: "d1", name: "Docs" }, { id: "d2", name: "Shared" }],
  })) as unknown as typeof fetch;
  const r = await listSharePointSiteDrives({
    accessToken: "tok", requestId: "r1", siteId: "s", fetchImpl,
  });
  assertEquals(r.category, "success");
  assertEquals(r.libraryCount, 2);
});

Deno.test("listSharePointSiteDrives: empty list -> libraries_not_found", async () => {
  const fetchImpl = (async () => fakeJsonResp(200, { value: [] })) as unknown as typeof fetch;
  const r = await listSharePointSiteDrives({
    accessToken: "tok", requestId: "r1", siteId: "s", fetchImpl,
  });
  assertEquals(r.category, "libraries_not_found");
  assertEquals(r.libraryCount, 0);
});

Deno.test("listSharePointSiteDrives: 429 -> rate_limited", async () => {
  const fetchImpl = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
  const r = await listSharePointSiteDrives({
    accessToken: "tok", requestId: "r1", siteId: "s", fetchImpl,
  });
  assertEquals(r.category, "rate_limited");
});

Deno.test("listSharePointSiteDrives: network error", async () => {
  const fetchImpl = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
  const r = await listSharePointSiteDrives({
    accessToken: "tok", requestId: "r1", siteId: "s", fetchImpl,
  });
  assertEquals(r.category, "network_error");
});

// ---------- Test-connection outcome evaluation ----------

Deno.test("evaluateSharePointTestOutcome: success only with libs", () => {
  assertEquals(evaluateSharePointTestOutcome({
    siteCategory: "success", librariesCategory: "success",
  }).classification, "connection_successful");
  assertEquals(evaluateSharePointTestOutcome({
    siteCategory: "success", librariesCategory: "libraries_not_found",
  }).classification, "sharepoint_libraries_unavailable");
  assertEquals(evaluateSharePointTestOutcome({
    siteCategory: "success", librariesCategory: null,
  }).classification, "sharepoint_unavailable");
  assertEquals(evaluateSharePointTestOutcome({
    siteCategory: "site_mismatch", librariesCategory: null,
  }).classification, "sharepoint_site_mismatch");
  assertEquals(evaluateSharePointTestOutcome({
    siteCategory: "site_not_found", librariesCategory: null,
  }).classification, "sharepoint_site_not_found");
});

Deno.test("classifySharePointTransport covers all categories", () => {
  assertEquals(classifySharePointTransport("success").classification,
    "connection_successful");
  assertEquals(classifySharePointTransport("permission_denied").classification,
    "sharepoint_permission_denied");
  assertEquals(classifySharePointTransport("permission_denied").recorderResult,
    "failure");
  assertEquals(classifySharePointTransport("token_rejected").classification,
    "sharepoint_graph_token_rejected");
  assertEquals(classifySharePointTransport("token_rejected").recorderResult,
    "failure");
  assertEquals(classifySharePointTransport("timeout").classification,
    "sharepoint_timeout");
  assertEquals(classifySharePointTransport("response_invalid").classification,
    "sharepoint_response_invalid");
});

Deno.test("classifySharePointResolverError mapping", () => {
  assertEquals(classifySharePointResolverError(
    new TenantSharePointError("secret_missing", "x")).classification,
    "sharepoint_not_configured");
  assertEquals(classifySharePointResolverError(
    new TenantSharePointError("integration_disabled", "x")).classification,
    "sharepoint_not_configured");
  assertEquals(classifySharePointResolverError(
    new TenantSharePointError("site_id_invalid", "x")).classification,
    "sharepoint_configuration_invalid");
  assertEquals(classifySharePointResolverError(
    new TenantSharePointError("environment_action_blocked", "x")).classification,
    "sharepoint_access_blocked");
  assertEquals(classifySharePointResolverError(
    new TenantSharePointError("environment_action_blocked", "x")).recorderResult,
    "blocked");
  assertEquals(classifySharePointResolverError(
    new TenantSharePointError("secret_blocked", "x")).recorderResult,
    "blocked");
  assertEquals(classifySharePointResolverError(new Error("x")).classification,
    "sharepoint_unavailable");
});

Deno.test("classifyGraphDependencyPublicError mapping", () => {
  assertEquals(classifyGraphDependencyPublicError("microsoft_graph_not_configured")
    .classification, "sharepoint_graph_not_configured");
  assertEquals(classifyGraphDependencyPublicError("microsoft_graph_access_blocked")
    .classification, "sharepoint_access_blocked");
  assertEquals(classifyGraphDependencyPublicError("microsoft_graph_configuration_unavailable")
    .classification, "sharepoint_unavailable");
});

Deno.test("entries include new classifications with failure recorder mapping", () => {
  assertEquals(SHAREPOINT_TEST_ENTRIES.connection_successful.recorderResult, "success");
  assertEquals(SHAREPOINT_TEST_ENTRIES.sharepoint_access_blocked.recorderResult, "blocked");
  assertEquals(SHAREPOINT_TEST_ENTRIES.sharepoint_permission_denied.recorderResult, "failure");
  assertEquals(SHAREPOINT_TEST_ENTRIES.sharepoint_permission_denied.safeErrorCode,
    "sharepoint_permission_denied");
  assertEquals(SHAREPOINT_TEST_ENTRIES.sharepoint_graph_token_rejected.recorderResult, "failure");
  assertEquals(SHAREPOINT_TEST_ENTRIES.sharepoint_site_mismatch.recorderResult, "failure");
});

// ---------- 4D.14A.7A.1: transport 401/403 semantics ----------

Deno.test("site resolution: 403 -> permission_denied classification (not blocked)", async () => {
  const configured = parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/sites/BTPM");
  if (!configured.ok) throw new Error("bad config");
  const fetchImpl = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
  const r = await resolveSharePointSiteByPath({
    accessToken: "tok", requestId: "r1",
    configuredSiteUrl: configured.value, fetchImpl,
  });
  assertEquals(r.category, "permission_denied");
  const entry = classifySharePointTransport(r.category);
  assertEquals(entry.classification, "sharepoint_permission_denied");
  assertEquals(entry.recorderResult, "failure");
});

Deno.test("site resolution: 401 -> token_rejected, recorder failure not blocked", async () => {
  const configured = parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/sites/BTPM");
  if (!configured.ok) throw new Error("bad config");
  const fetchImpl = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  const r = await resolveSharePointSiteByPath({
    accessToken: "tok", requestId: "r1",
    configuredSiteUrl: configured.value, fetchImpl,
  });
  assertEquals(r.category, "token_rejected");
  const entry = classifySharePointTransport(r.category);
  assertEquals(entry.classification, "sharepoint_graph_token_rejected");
  assertEquals(entry.recorderResult, "failure");
});

Deno.test("libraries: 403 -> permission_denied classification (not blocked)", async () => {
  const fetchImpl = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
  const r = await listSharePointSiteDrives({
    accessToken: "tok", requestId: "r1", siteId: "s", fetchImpl,
  });
  assertEquals(r.category, "permission_denied");
  assertEquals(
    classifySharePointTransport(r.category).classification,
    "sharepoint_permission_denied",
  );
});

Deno.test("site resolution: timeout via aborted fetch", async () => {
  const configured = parseAndNormalizeSharePointSiteUrl(
    "https://contoso.sharepoint.com/sites/BTPM");
  if (!configured.ok) throw new Error("bad config");
  const fetchImpl = (async () => {
    const err = new Error("aborted");
    (err as { name?: string }).name = "AbortError";
    throw err;
  }) as unknown as typeof fetch;
  const r = await resolveSharePointSiteByPath({
    accessToken: "tok", requestId: "r1",
    configuredSiteUrl: configured.value, fetchImpl,
  });
  assertEquals(r.category, "timeout");
});

Deno.test("libraries: timeout via aborted fetch", async () => {
  const fetchImpl = (async () => {
    const err = new Error("aborted");
    (err as { name?: string }).name = "AbortError";
    throw err;
  }) as unknown as typeof fetch;
  const r = await listSharePointSiteDrives({
    accessToken: "tok", requestId: "r1", siteId: "s", fetchImpl,
  });
  assertEquals(r.category, "timeout");
});

