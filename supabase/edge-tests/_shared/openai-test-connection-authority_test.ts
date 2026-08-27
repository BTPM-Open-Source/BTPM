// Phase 4D.14A.5A — Authority tests for the openai-test-connection Edge
// Function. The Edge Function reuses `evaluateAuthority` from
// adminAuthority.ts; these tests exercise the OpenAI-specific
// wiring — Org Admin, owning Tenant Admin, foreign Tenant Admin,
// unrelated user, one-role-proven-with-other-RPC-failing, and Org
// non-enumeration.

import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  type AuthorityCheckDeps,
  evaluateAuthority,
} from "../../functions/_shared/adminAuthority.ts";

function deps(overrides: Partial<AuthorityCheckDeps>): AuthorityCheckDeps {
  return {
    fetchOrgTenant: () =>
      Promise.resolve({
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        error: false,
      }),
    isOrgAdmin: () => Promise.resolve({ value: false, error: false }),
    isTenantAdmin: () => Promise.resolve({ value: false, error: false }),
    ...overrides,
  };
}

Deno.test("openai-test authority: Org Admin accepted", async () => {
  const out = await evaluateAuthority("u", "o", deps({
    isOrgAdmin: () => Promise.resolve({ value: true, error: false }),
  }));
  assertEquals(out.outcome, "allowed_org_admin");
});

Deno.test("openai-test authority: owning Tenant Admin accepted", async () => {
  const out = await evaluateAuthority("u", "o", deps({
    isTenantAdmin: () => Promise.resolve({ value: true, error: false }),
  }));
  assertEquals(out.outcome, "allowed_tenant_admin");
});

Deno.test("openai-test authority: foreign Tenant Admin rejected", async () => {
  // Simulate: the caller is admin of some other tenant, but is_tenant_admin
  // for the owning tenant returns false. The DB call resolves the owning
  // tenant via the service role; caller-supplied tenant is never trusted.
  const out = await evaluateAuthority("u", "o", deps({
    isTenantAdmin: () => Promise.resolve({ value: false, error: false }),
  }));
  assertEquals(out.outcome, "denied");
});

Deno.test("openai-test authority: unrelated user rejected", async () => {
  const out = await evaluateAuthority("u", "o", deps({}));
  assertEquals(out.outcome, "denied");
});

Deno.test("openai-test authority: Org Admin proven despite Tenant RPC error accepted", async () => {
  const out = await evaluateAuthority("u", "o", deps({
    isOrgAdmin: () => Promise.resolve({ value: true, error: false }),
    isTenantAdmin: () => Promise.resolve({ value: null, error: true }),
  }));
  assertEquals(out.outcome, "allowed_org_admin");
});

Deno.test("openai-test authority: Tenant Admin proven despite Org RPC error accepted", async () => {
  const out = await evaluateAuthority("u", "o", deps({
    isOrgAdmin: () => Promise.resolve({ value: null, error: true }),
    isTenantAdmin: () => Promise.resolve({ value: true, error: false }),
  }));
  assertEquals(out.outcome, "allowed_tenant_admin");
});

Deno.test("openai-test authority: missing Organization is indistinguishable from unauthorized", async () => {
  const missingOrgOut = await evaluateAuthority("u", "o", deps({
    fetchOrgTenant: () => Promise.resolve({ tenantId: null, error: false }),
  }));
  const unauthorizedOut = await evaluateAuthority("u", "o", deps({}));
  assertEquals(missingOrgOut.outcome, "denied");
  assertEquals(unauthorizedOut.outcome, "denied");
});

Deno.test("openai-test authority: infra failure signalled distinctly", async () => {
  const out = await evaluateAuthority("u", "o", deps({
    fetchOrgTenant: () => Promise.resolve({ tenantId: null, error: true }),
  }));
  assertEquals(out.outcome, "infra_failure");
});
