// Phase 4D.14A.8A — Pure classifier + safe-error unit tests for
// tenantAzureOpenAi.ts. No live Supabase/Vault.

import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  classifyAzureEndpointFromMetadata,
  classifyAzureEnvironmentGateError,
  classifyAzureIntegrationLookup,
  classifyAzureOrganizationLookup,
  mapTenantSecretErrorToAzureCode,
  TenantAzureOpenAiError,
  toSafeAzureOpenAiPublicError,
} from "../../functions/_shared/tenantAzureOpenAi.ts";

const FORBIDDEN = [
  "api_key",
  "AZURE_OPENAI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "vault",
  "endpoint=",
  "api-key",
];

function assertSafe(obj: { error: string; note: string }) {
  const s = `${obj.error} ${obj.note}`.toLowerCase();
  for (const tok of FORBIDDEN) {
    if (s.includes(tok.toLowerCase())) {
      throw new Error(`leaked ${tok}`);
    }
  }
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s)) {
    throw new Error("leaked uuid");
  }
}

Deno.test("mapTenantSecretErrorToAzureCode covers all resolver codes", () => {
  assertEquals(mapTenantSecretErrorToAzureCode("blocked"), "secret_blocked");
  assertEquals(mapTenantSecretErrorToAzureCode("not_found"), "secret_missing");
  assertEquals(mapTenantSecretErrorToAzureCode("empty"), "secret_missing");
  assertEquals(
    mapTenantSecretErrorToAzureCode("malformed"),
    "configuration_unavailable",
  );
  assertEquals(
    mapTenantSecretErrorToAzureCode("resolver_unavailable"),
    "configuration_unavailable",
  );
});

Deno.test("classifyAzureEnvironmentGateError only blocks on 42501", () => {
  assertEquals(
    classifyAzureEnvironmentGateError({ code: "42501" }),
    "environment_action_blocked",
  );
  assertEquals(
    classifyAzureEnvironmentGateError({ code: "PGRST000" }),
    "configuration_unavailable",
  );
  assertEquals(
    classifyAzureEnvironmentGateError(null),
    "configuration_unavailable",
  );
});

Deno.test("classifyAzureOrganizationLookup splits infra vs not_found", () => {
  assertEquals(
    classifyAzureOrganizationLookup(new Error("x"), null),
    { ok: false, code: "configuration_unavailable" },
  );
  assertEquals(
    classifyAzureOrganizationLookup(null, null),
    { ok: false, code: "organization_not_found" },
  );
  assertEquals(
    classifyAzureOrganizationLookup(null, { tenant_id: "t1" }),
    { ok: true, tenantId: "t1" },
  );
});

Deno.test("classifyAzureIntegrationLookup enforces enabled + active", () => {
  assertEquals(
    classifyAzureIntegrationLookup(null, null),
    { ok: false, code: "integration_not_configured" },
  );
  assertEquals(
    classifyAzureIntegrationLookup(null, {
      id: "i1",
      is_enabled: false,
      status: "active",
      config_metadata: {},
    }),
    { ok: false, code: "integration_disabled" },
  );
  assertEquals(
    classifyAzureIntegrationLookup(null, {
      id: "i1",
      is_enabled: true,
      status: "not_configured",
      config_metadata: {},
    }),
    { ok: false, code: "integration_disabled" },
  );
  const ok = classifyAzureIntegrationLookup(null, {
    id: "i1",
    is_enabled: true,
    status: "active",
    config_metadata: { endpoint: "x" },
  });
  assertEquals(ok.ok, true);
});

Deno.test("classifyAzureEndpointFromMetadata splits missing vs invalid", () => {
  assertEquals(
    classifyAzureEndpointFromMetadata(null),
    { ok: false, code: "endpoint_missing" },
  );
  assertEquals(
    classifyAzureEndpointFromMetadata({}),
    { ok: false, code: "endpoint_missing" },
  );
  assertEquals(
    classifyAzureEndpointFromMetadata({ endpoint: "" }),
    { ok: false, code: "endpoint_missing" },
  );
  assertEquals(
    classifyAzureEndpointFromMetadata({ endpoint: "http://foo.bar" }),
    { ok: false, code: "endpoint_invalid" },
  );
  const ok = classifyAzureEndpointFromMetadata({
    endpoint: "https://acme.openai.azure.com",
  });
  assertEquals(ok.ok, true);
  if (ok.ok) {
    assertEquals(ok.endpoint, "https://acme.openai.azure.com");
    assertEquals(ok.baseUrl, "https://acme.openai.azure.com/openai/v1");
  }
});

Deno.test("toSafeAzureOpenAiPublicError collapses to three contracts", () => {
  const cases: Array<
    [InstanceType<typeof TenantAzureOpenAiError>["code"], string]
  > = [
    ["environment_action_blocked", "azure_openai_access_blocked"],
    ["secret_blocked", "azure_openai_access_blocked"],
    ["integration_not_configured", "azure_openai_not_configured"],
    ["integration_disabled", "azure_openai_not_configured"],
    ["endpoint_missing", "azure_openai_not_configured"],
    ["endpoint_invalid", "azure_openai_not_configured"],
    ["secret_missing", "azure_openai_not_configured"],
    ["organization_context_missing", "azure_openai_configuration_unavailable"],
    ["organization_not_found", "azure_openai_configuration_unavailable"],
    ["configuration_unavailable", "azure_openai_configuration_unavailable"],
  ];
  for (const [code, expected] of cases) {
    const r = toSafeAzureOpenAiPublicError(
      new TenantAzureOpenAiError(code, "internal text"),
    );
    assertEquals(r.error, expected, `for ${code}`);
    assertSafe(r);
  }
  // Unknown errors default to configuration_unavailable.
  const rUnknown = toSafeAzureOpenAiPublicError(new Error("x"));
  assertEquals(rUnknown.error, "azure_openai_configuration_unavailable");
});
