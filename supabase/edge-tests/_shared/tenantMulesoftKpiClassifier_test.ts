// Phase 4D.14A.2A.1 — Tenant secret resolver failure classification.
//
// Verifies mapTenantSecretErrorToMulesoftKpiCode and the composition with
// toSafeMulesoftKpiPublicError produce the correct public codes and safe
// messages, and that unknown errors fall back to configuration_unavailable.
//
// Run with:
//   deno test supabase/edge-tests/_shared/tenantMulesoftKpiClassifier_test.ts \
//     --allow-net --allow-env

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mapTenantSecretErrorToMulesoftKpiCode,
  toSafeMulesoftKpiPublicError,
  TenantMulesoftKpiError,
  MULESOFT_KPI_PUBLIC_MESSAGES,
} from "../../functions/_shared/tenantMulesoftKpi.ts";
import { TenantIntegrationSecretError } from "../../functions/_shared/tenantIntegrationSecrets.ts";

const FORBIDDEN_SUBSTRINGS = [
  "api_url",
  "username",
  "password",
  "SUPABASE_SERVICE_ROLE_KEY",
  "vault",
  "postgres",
  "PGRST",
];

function assertSafe(message: string, extra: string[] = []) {
  for (const s of [...FORBIDDEN_SUBSTRINGS, ...extra]) {
    assert(
      !message.toLowerCase().includes(s.toLowerCase()),
      `Public message must not contain '${s}': ${message}`,
    );
  }
}

Deno.test("classifier maps blocked → secret_blocked", () => {
  assertEquals(mapTenantSecretErrorToMulesoftKpiCode("blocked"), "secret_blocked");
});

Deno.test("classifier maps not_found → secret_missing", () => {
  assertEquals(mapTenantSecretErrorToMulesoftKpiCode("not_found"), "secret_missing");
});

Deno.test("classifier maps empty → secret_missing", () => {
  assertEquals(mapTenantSecretErrorToMulesoftKpiCode("empty"), "secret_missing");
});

Deno.test("classifier maps malformed → configuration_unavailable", () => {
  assertEquals(
    mapTenantSecretErrorToMulesoftKpiCode("malformed"),
    "configuration_unavailable",
  );
});

Deno.test("classifier maps resolver_unavailable → configuration_unavailable", () => {
  assertEquals(
    mapTenantSecretErrorToMulesoftKpiCode("resolver_unavailable"),
    "configuration_unavailable",
  );
});

Deno.test("end-to-end: resolver_unavailable surfaces as MULESOFT_KPI_CONFIGURATION_UNAVAILABLE", () => {
  const rawRpc =
    "psql relation vault.decrypted_secrets api_url username password " +
    "a1b2c3d4-e5f6-7890-abcd-ef0123456789 SUPABASE_SERVICE_ROLE_KEY PGRST200";
  const inner = new TenantIntegrationSecretError(
    "resolver_unavailable",
    rawRpc,
    "mulesoft_kpi",
    "api_url",
  );
  const mapped = mapTenantSecretErrorToMulesoftKpiCode(inner.code);
  const outer = new TenantMulesoftKpiError(mapped, MULESOFT_KPI_PUBLIC_MESSAGES[mapped]);
  const safe = toSafeMulesoftKpiPublicError(outer);
  assertEquals(safe.code, "MULESOFT_KPI_CONFIGURATION_UNAVAILABLE");
  assertEquals(
    safe.message,
    "The MuleSoft KPI Tenant integration configuration is temporarily unavailable.",
  );
  assertSafe(safe.message, [rawRpc, "a1b2c3d4-e5f6-7890-abcd-ef0123456789"]);
});

Deno.test("end-to-end: malformed surfaces as MULESOFT_KPI_CONFIGURATION_UNAVAILABLE", () => {
  const inner = new TenantIntegrationSecretError(
    "malformed",
    "unrecognized status",
    "mulesoft_kpi",
    "api_url",
  );
  const mapped = mapTenantSecretErrorToMulesoftKpiCode(inner.code);
  const outer = new TenantMulesoftKpiError(mapped, MULESOFT_KPI_PUBLIC_MESSAGES[mapped]);
  const safe = toSafeMulesoftKpiPublicError(outer);
  assertEquals(safe.code, "MULESOFT_KPI_CONFIGURATION_UNAVAILABLE");
  assertSafe(safe.message);
});

Deno.test("end-to-end: blocked surfaces as MULESOFT_KPI_SECRET_BLOCKED", () => {
  const inner = new TenantIntegrationSecretError(
    "blocked",
    "organization override disabled",
    "mulesoft_kpi",
    "api_url",
  );
  const mapped = mapTenantSecretErrorToMulesoftKpiCode(inner.code);
  const outer = new TenantMulesoftKpiError(mapped, MULESOFT_KPI_PUBLIC_MESSAGES[mapped]);
  const safe = toSafeMulesoftKpiPublicError(outer);
  assertEquals(safe.code, "MULESOFT_KPI_SECRET_BLOCKED");
  assertSafe(safe.message);
});

Deno.test("end-to-end: not_found and empty surface as MULESOFT_KPI_SECRET_MISSING", () => {
  for (const code of ["not_found", "empty"] as const) {
    const inner = new TenantIntegrationSecretError(
      code,
      `secret ${code}`,
      "mulesoft_kpi",
      "username",
    );
    const mapped = mapTenantSecretErrorToMulesoftKpiCode(inner.code);
    const outer = new TenantMulesoftKpiError(mapped, MULESOFT_KPI_PUBLIC_MESSAGES[mapped]);
    const safe = toSafeMulesoftKpiPublicError(outer);
    assertEquals(safe.code, "MULESOFT_KPI_SECRET_MISSING");
    assertSafe(safe.message);
  }
});

Deno.test("arbitrary unknown Error maps to MULESOFT_KPI_CONFIGURATION_UNAVAILABLE", () => {
  const safe = toSafeMulesoftKpiPublicError(
    new Error("unexpected fetch failure api_url username password"),
  );
  assertEquals(safe.code, "MULESOFT_KPI_CONFIGURATION_UNAVAILABLE");
  assertSafe(safe.message);
});
