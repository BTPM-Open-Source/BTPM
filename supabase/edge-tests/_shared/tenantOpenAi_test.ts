// Phase 4D.14A.3B — targeted unit tests for the pure classifier and
// safe public error mapper in tenantOpenAi.ts. These do not open a live
// Supabase / Vault connection.

import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  classifyEnvironmentGateError,
  classifyOpenAiIntegrationLookup,
  classifyOrganizationLookup,
  mapTenantSecretErrorToOpenAiCode,
  toSafeOpenAiPublicError,
  TenantOpenAiError,
} from "../../functions/_shared/tenantOpenAi.ts";

const FORBIDDEN = [
  "api_key",
  "OPENAI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "vault",
  "sk-",
  "Bearer ",
];

function assertPublicSafe(obj: { error: string; note: string }) {
  const s = `${obj.error} ${obj.note}`.toLowerCase();
  for (const tok of FORBIDDEN) {
    if (s.includes(tok.toLowerCase())) {
      throw new Error(`Public error leaked forbidden token: ${tok}`);
    }
  }
  // No UUID-like tokens.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s)) {
    throw new Error("Public error leaked UUID");
  }
}

Deno.test("mapTenantSecretErrorToOpenAiCode classifies each resolver code", () => {
  assertEquals(mapTenantSecretErrorToOpenAiCode("blocked"), "secret_blocked");
  assertEquals(mapTenantSecretErrorToOpenAiCode("not_found"), "secret_missing");
  assertEquals(mapTenantSecretErrorToOpenAiCode("empty"), "secret_missing");
  assertEquals(mapTenantSecretErrorToOpenAiCode("malformed"), "configuration_unavailable");
  assertEquals(mapTenantSecretErrorToOpenAiCode("resolver_unavailable"), "configuration_unavailable");
});

Deno.test("toSafeOpenAiPublicError → openai_access_blocked on blocked", () => {
  const r = toSafeOpenAiPublicError(new TenantOpenAiError("secret_blocked", "internal text"));
  assertEquals(r.error, "openai_access_blocked");
  assertPublicSafe(r);
});

Deno.test("toSafeOpenAiPublicError → openai_access_blocked on environment gate", () => {
  const r = toSafeOpenAiPublicError(
    new TenantOpenAiError("environment_action_blocked", "internal text"),
  );
  assertEquals(r.error, "openai_access_blocked");
  assertPublicSafe(r);
});

Deno.test("toSafeOpenAiPublicError → openai_not_configured on missing / disabled", () => {
  for (const code of ["integration_not_configured", "integration_disabled", "secret_missing"] as const) {
    const r = toSafeOpenAiPublicError(new TenantOpenAiError(code, "x"));
    assertEquals(r.error, "openai_not_configured");
    assertPublicSafe(r);
  }
});

Deno.test("toSafeOpenAiPublicError → openai_configuration_unavailable on malformed / resolver failures", () => {
  for (const code of ["configuration_unavailable", "organization_context_missing", "organization_not_found"] as const) {
    const r = toSafeOpenAiPublicError(new TenantOpenAiError(code, "x"));
    assertEquals(r.error, "openai_configuration_unavailable");
    assertPublicSafe(r);
  }
});

Deno.test("toSafeOpenAiPublicError → openai_configuration_unavailable on unknown errors", () => {
  const r = toSafeOpenAiPublicError(new Error("raw rpc: could not connect to vault (id 00000000-0000-0000-0000-000000000000)"));
  assertEquals(r.error, "openai_configuration_unavailable");
  assertPublicSafe(r);
});

Deno.test("public errors never leak forbidden tokens even with hostile internal text", () => {
  const hostile = new TenantOpenAiError(
    "secret_missing",
    "api_key OPENAI_API_KEY sk-abcd Bearer vault 11111111-1111-1111-1111-111111111111",
  );
  const r = toSafeOpenAiPublicError(hostile);
  assertPublicSafe(r);
});

// --- Phase 4D.14A.3B.1 — infrastructure vs policy classification ---

Deno.test("classifyEnvironmentGateError: 42501 → environment_action_blocked", () => {
  assertEquals(
    classifyEnvironmentGateError({ code: "42501" }),
    "environment_action_blocked",
  );
});

Deno.test("classifyEnvironmentGateError: non-42501 codes → configuration_unavailable", () => {
  for (const code of ["PGRST301", "08006", "XX000", "", null, undefined]) {
    assertEquals(
      classifyEnvironmentGateError({ code: code as string | null }),
      "configuration_unavailable",
    );
  }
  assertEquals(classifyEnvironmentGateError(null), "configuration_unavailable");
  assertEquals(classifyEnvironmentGateError(undefined), "configuration_unavailable");
});

Deno.test("classifyOrganizationLookup: query error → configuration_unavailable", () => {
  const r = classifyOrganizationLookup(
    { code: "08006", message: "connection lost" },
    null,
  );
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "configuration_unavailable");
});

Deno.test("classifyOrganizationLookup: no row → organization_not_found", () => {
  const r = classifyOrganizationLookup(null, null);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "organization_not_found");
});

Deno.test("classifyOrganizationLookup: row without tenant_id → organization_not_found", () => {
  const r = classifyOrganizationLookup(null, { tenant_id: null });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "organization_not_found");
});

Deno.test("classifyOrganizationLookup: row with tenant_id → ok", () => {
  const r = classifyOrganizationLookup(null, { tenant_id: "t-1" });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.tenantId, "t-1");
});

Deno.test("classifyOpenAiIntegrationLookup: query error → configuration_unavailable", () => {
  const r = classifyOpenAiIntegrationLookup(
    { code: "PGRST", message: "boom" },
    null,
  );
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "configuration_unavailable");
});

Deno.test("classifyOpenAiIntegrationLookup: absent row → integration_not_configured", () => {
  const r = classifyOpenAiIntegrationLookup(null, null);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "integration_not_configured");
});

Deno.test("classifyOpenAiIntegrationLookup: disabled → integration_disabled", () => {
  const r = classifyOpenAiIntegrationLookup(null, {
    id: "i-1",
    is_enabled: false,
    status: "active",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "integration_disabled");
});

Deno.test("classifyOpenAiIntegrationLookup: non-active status → integration_disabled", () => {
  const r = classifyOpenAiIntegrationLookup(null, {
    id: "i-1",
    is_enabled: true,
    status: "suspended",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "integration_disabled");
});

Deno.test("classifyOpenAiIntegrationLookup: enabled + active → ok", () => {
  const r = classifyOpenAiIntegrationLookup(null, {
    id: "i-1",
    is_enabled: true,
    status: "active",
  });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.integrationId, "i-1");
});

Deno.test("public output for infra gate failure is configuration_unavailable, not blocked", () => {
  const code = classifyEnvironmentGateError({ code: "08006" });
  const r = toSafeOpenAiPublicError(new TenantOpenAiError(code, "raw pg text"));
  assertEquals(r.error, "openai_configuration_unavailable");
  const s = `${r.error} ${r.note}`.toLowerCase();
  for (const forbidden of ["api_key", "openai_api_key", "supabase_service_role_key", "vault", "sk-", "bearer ", "pg", "rpc", "08006"]) {
    if (s.includes(forbidden)) throw new Error(`leaked: ${forbidden}`);
  }
});

Deno.test("public output for real 42501 gate rejection is openai_access_blocked", () => {
  const code = classifyEnvironmentGateError({ code: "42501" });
  const r = toSafeOpenAiPublicError(new TenantOpenAiError(code, "internal"));
  assertEquals(r.error, "openai_access_blocked");
});
