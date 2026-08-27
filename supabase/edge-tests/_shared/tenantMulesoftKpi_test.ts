// Phase 4D.14A.2A — Safe public-error mapper regression coverage.
//
// Run with:
//   deno test supabase/edge-tests/_shared/tenantMulesoftKpi_test.ts \
//     --allow-net --allow-env
//
// Verifies that toSafeMulesoftKpiPublicError:
//   - maps every known TenantMulesoftKpiError code to the expected public
//     code + message,
//   - maps an arbitrary Error (containing internal RPC-style text) to the
//     generic configuration_unavailable response,
//   - never leaks logical secret names, env-var names, IDs, or the raw
//     original error message.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  toSafeMulesoftKpiPublicError,
  TenantMulesoftKpiError,
} from "../../functions/_shared/tenantMulesoftKpi.ts";

const FORBIDDEN_SUBSTRINGS = [
  "api_url",
  "username",
  "password",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function assertSafe(message: string, extraForbidden: string[] = []) {
  for (const s of [...FORBIDDEN_SUBSTRINGS, ...extraForbidden]) {
    assert(
      !message.toLowerCase().includes(s.toLowerCase()),
      `Public message must not contain '${s}': ${message}`,
    );
  }
}

const CASES: Array<{
  code:
    | "organization_context_missing"
    | "organization_not_found"
    | "environment_action_blocked"
    | "integration_not_configured"
    | "integration_disabled"
    | "secret_missing"
    | "secret_blocked"
    | "api_url_invalid"
    | "configuration_unavailable";
  expected_public_code: string;
  expected_message: string;
}> = [
  {
    code: "organization_context_missing",
    expected_public_code: "MULESOFT_KPI_ORGANIZATION_CONTEXT_MISSING",
    expected_message: "Organization context is unavailable.",
  },
  {
    code: "organization_not_found",
    expected_public_code: "MULESOFT_KPI_ORGANIZATION_NOT_FOUND",
    expected_message: "The Organization could not be resolved.",
  },
  {
    code: "environment_action_blocked",
    expected_public_code: "MULESOFT_KPI_ENVIRONMENT_ACTION_BLOCKED",
    expected_message:
      "MuleSoft KPI access is not allowed in this environment.",
  },
  {
    code: "integration_not_configured",
    expected_public_code: "MULESOFT_KPI_INTEGRATION_NOT_CONFIGURED",
    expected_message: "The MuleSoft KPI Tenant integration is not configured.",
  },
  {
    code: "integration_disabled",
    expected_public_code: "MULESOFT_KPI_INTEGRATION_DISABLED",
    expected_message:
      "The MuleSoft KPI Tenant integration is disabled or incomplete.",
  },
  {
    code: "secret_missing",
    expected_public_code: "MULESOFT_KPI_SECRET_MISSING",
    expected_message: "The MuleSoft KPI Tenant integration is incomplete.",
  },
  {
    code: "secret_blocked",
    expected_public_code: "MULESOFT_KPI_SECRET_BLOCKED",
    expected_message:
      "The MuleSoft KPI Tenant integration is disabled for this Organization.",
  },
  {
    code: "api_url_invalid",
    expected_public_code: "MULESOFT_KPI_API_URL_INVALID",
    expected_message: "The MuleSoft KPI Tenant integration API URL is invalid.",
  },
  {
    code: "configuration_unavailable",
    expected_public_code: "MULESOFT_KPI_CONFIGURATION_UNAVAILABLE",
    expected_message:
      "The MuleSoft KPI Tenant integration configuration is temporarily unavailable.",
  },
];

Deno.test("toSafeMulesoftKpiPublicError maps every known internal code", () => {
  for (const c of CASES) {
    const err = new TenantMulesoftKpiError(c.code, "internal detail — do not leak");
    const safe = toSafeMulesoftKpiPublicError(err);
    assertEquals(safe.code, c.expected_public_code);
    assertEquals(safe.message, c.expected_message);
    assertSafe(safe.message);
  }
});

Deno.test("toSafeMulesoftKpiPublicError maps unknown Error to generic safe response", () => {
  const supplied =
    "psql: relation \"vault.decrypted_secrets\" api_url username password " +
    "a1b2c3d4-e5f6-7890-abcd-ef0123456789";
  const err = new Error(supplied);
  const safe = toSafeMulesoftKpiPublicError(err);
  assertEquals(safe.code, "MULESOFT_KPI_CONFIGURATION_UNAVAILABLE");
  assertEquals(
    safe.message,
    "The MuleSoft KPI Tenant integration configuration is temporarily unavailable.",
  );
  assertSafe(safe.message, [
    "psql",
    "vault.decrypted_secrets",
    "a1b2c3d4-e5f6-7890-abcd-ef0123456789",
    supplied,
  ]);
});

Deno.test("toSafeMulesoftKpiPublicError handles non-Error input safely", () => {
  const safe = toSafeMulesoftKpiPublicError("api_url missing / username missing");
  assertEquals(safe.code, "MULESOFT_KPI_CONFIGURATION_UNAVAILABLE");
  assertSafe(safe.message);
});
