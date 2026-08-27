// Provider-neutral tests for the shared Tenant and Organization
// administrator authority evaluator.

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

Deno.test("evaluateAuthority: Organization Admin accepted as org_admin", async () => {
  const out = await evaluateAuthority(
    "u1",
    "o1",
    deps({ isOrgAdmin: () => Promise.resolve({ value: true, error: false }) }),
  );
  assertEquals(out.outcome, "allowed_org_admin");
});

Deno.test("evaluateAuthority: Tenant Admin accepted as tenant_admin", async () => {
  const out = await evaluateAuthority(
    "u1",
    "o1",
    deps({
      isTenantAdmin: () => Promise.resolve({ value: true, error: false }),
    }),
  );
  assertEquals(out.outcome, "allowed_tenant_admin");
});

Deno.test("evaluateAuthority: Org Admin true + Tenant Admin RPC failure → allowed_org_admin", async () => {
  const out = await evaluateAuthority(
    "u1",
    "o1",
    deps({
      isOrgAdmin: () => Promise.resolve({ value: true, error: false }),
      isTenantAdmin: () => Promise.resolve({ value: null, error: true }),
    }),
  );
  assertEquals(out.outcome, "allowed_org_admin");
});

Deno.test("evaluateAuthority: Tenant Admin true + Org Admin RPC failure → allowed_tenant_admin", async () => {
  const out = await evaluateAuthority(
    "u1",
    "o1",
    deps({
      isOrgAdmin: () => Promise.resolve({ value: null, error: true }),
      isTenantAdmin: () => Promise.resolve({ value: true, error: false }),
    }),
  );
  assertEquals(out.outcome, "allowed_tenant_admin");
});

Deno.test("evaluateAuthority: neither proven + one RPC failure → infra_failure", async () => {
  const out = await evaluateAuthority(
    "u1",
    "o1",
    deps({
      isTenantAdmin: () => Promise.resolve({ value: null, error: true }),
    }),
  );
  assertEquals(out.outcome, "infra_failure");
});

Deno.test("evaluateAuthority: unrelated caller denied", async () => {
  const out = await evaluateAuthority("u1", "o1", deps({}));
  assertEquals(out.outcome, "denied");
});

Deno.test("evaluateAuthority: Tenant Admin for a different tenant is denied", async () => {
  const out = await evaluateAuthority(
    "u1",
    "o1",
    deps({
      fetchOrgTenant: () =>
        Promise.resolve({
          tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          error: false,
        }),
      isTenantAdmin: (_uid, tid) =>
        Promise.resolve({
          value: tid === "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          error: false,
        }),
    }),
  );
  assertEquals(out.outcome, "denied");
});

Deno.test("evaluateAuthority: missing Organization returns denied (non-enumeration)", async () => {
  const out = await evaluateAuthority(
    "u1",
    "o1",
    deps({
      fetchOrgTenant: () =>
        Promise.resolve({ tenantId: null, error: false }),
    }),
  );
  assertEquals(out.outcome, "denied");
});

Deno.test("evaluateAuthority: org lookup infra failure returns infra_failure", async () => {
  const out = await evaluateAuthority(
    "u1",
    "o1",
    deps({
      fetchOrgTenant: () =>
        Promise.resolve({ tenantId: null, error: true }),
    }),
  );
  assertEquals(out.outcome, "infra_failure");
});
