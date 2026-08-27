// Phase 4D.14A.7H — password-reset Organization resolver + route selection.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyPasswordResetRoute } from "../../functions/_shared/passwordResetOrganizationResolver.ts";

Deno.test("valid last-active Organization is accepted", () => {
  const r = classifyPasswordResetRoute("org-1", [
    { organization_id: "org-1", status: "active" },
    { organization_id: "org-2", status: "active" },
  ]);
  assertEquals(r, { kind: "tenant", organizationId: "org-1" });
});

Deno.test("stale / non-member last-active Organization is rejected — sole membership is used", () => {
  const r = classifyPasswordResetRoute("org-stale", [
    { organization_id: "org-1", status: "active" },
  ]);
  assertEquals(r, { kind: "tenant", organizationId: "org-1" });
});

Deno.test("stale last-active + multiple active memberships → platform_auth", () => {
  const r = classifyPasswordResetRoute("org-stale", [
    { organization_id: "org-1", status: "active" },
    { organization_id: "org-2", status: "active" },
  ]);
  assertEquals(r, { kind: "platform_auth" });
});

Deno.test("sole active Organization is accepted with no preference", () => {
  const r = classifyPasswordResetRoute(null, [
    { organization_id: "org-1", status: "active" },
  ]);
  assertEquals(r, { kind: "tenant", organizationId: "org-1" });
});

Deno.test("multiple active Organizations with no valid preference → platform_auth", () => {
  const r = classifyPasswordResetRoute(null, [
    { organization_id: "org-1", status: "active" },
    { organization_id: "org-2", status: "active" },
  ]);
  assertEquals(r, { kind: "platform_auth" });
});

Deno.test("no active membership → platform_auth", () => {
  const r = classifyPasswordResetRoute(null, [
    { organization_id: "org-1", status: "deactivated" },
  ]);
  assertEquals(r, { kind: "platform_auth" });
});

Deno.test("empty / missing memberships → platform_auth", () => {
  assertEquals(classifyPasswordResetRoute(null, []), { kind: "platform_auth" });
  assertEquals(classifyPasswordResetRoute(null, null), { kind: "platform_auth" });
});

Deno.test("only inactive memberships even with a preference → platform_auth", () => {
  const r = classifyPasswordResetRoute("org-1", [
    { organization_id: "org-1", status: "deactivated" },
  ]);
  assertEquals(r, { kind: "platform_auth" });
});
