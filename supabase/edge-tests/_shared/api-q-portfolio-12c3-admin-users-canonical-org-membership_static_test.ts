/**
 * Portfolio-12C.3 — Portfolio Owner Picker canonical Organization membership.
 *
 * The Portfolio Owner picker consumes the generic admin-users directory
 * (action: "list"). These focused static checks prove the membership-resolution
 * portion of supabase/functions/admin-users/index.ts follows the canonical
 * transition-aware model implemented by public.is_org_member:
 *
 *  1. active organization_memberships + active tenant_memberships → included
 *     even when profiles.organization_id points at another Organization;
 *  2. an inactive/removed organization_memberships row cannot be resurrected by
 *     the legacy profiles.organization_id pointer;
 *  3. an inactive tenant_memberships row excludes the user;
 *  4. the legacy profile pointer fallback survives only when no
 *     organization_memberships row exists for that user + Organization;
 *  5. queries stay bounded to the requested Organization and relevant users;
 *  6. the AdminUserRow response contract is unchanged;
 *  7. browser-session-only protection remains in place.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE_URL = new URL("../../functions/admin-users/index.ts", import.meta.url);
const source = await Deno.readTextFile(SOURCE_URL);

Deno.test("12C.3 — canonical membership resolver exists and is Organization-bounded", () => {
  assert(source.includes("async function resolveCanonicalOrganizationMembership("));
  assert(source.includes('.from("organization_memberships")'));
  assert(source.includes('.select("user_id, tenant_id, status")'));
  assert(source.includes('.eq("organization_id", organizationId)'));
});

Deno.test("12C.3 — membership row existence is tracked separately from active state", () => {
  assert(source.includes("const membershipRowUserIds = new Set(rows.map((row) => row.user_id));"));
  assert(source.includes('rows.filter((row) => row.status === "active" && row.tenant_id)'));
  assert(source.includes("const canonicalActiveUserIds = new Set<string>();"));
});

Deno.test("12C.3 — active tenant membership is required and bounded to relevant users/tenants", () => {
  assert(source.includes('.from("tenant_memberships")'));
  assert(source.includes('.in("user_id", userIds)'));
  assert(source.includes('.in("tenant_id", tenantIds)'));
  assert(source.includes('.filter((row) => row.status === "active")'));
  assert(source.includes("activeTenantPairs.has(`${row.user_id}:${row.tenant_id}`)"));
});

Deno.test("12C.3 — canonical members are included regardless of legacy profile pointer", () => {
  // Profiles for canonical members are fetched by ID, not by organization_id.
  assert(source.includes("canonicalUserIds.length > 0"));
  assert(source.includes('.in("id", canonicalUserIds)'));
  assert(source.includes("for (const profile of (canonicalProfilesResult.data ?? []) as OrganizationProfileRecord[]) {"));
  assert(source.includes("scopedProfilesById.set(profile.id, profile);"));
  assert(source.includes("const isCanonicalMember = canonicalActiveUserIds.has(authUser.id);"));
});

Deno.test("12C.3 — inactive membership row blocks the legacy profile fallback", () => {
  assert(source.includes("if (membershipRowUserIds.has(profile.id)) continue;"));
  assert(source.includes("if (!isCanonicalMember && membershipRowUserIds.has(authUser.id)) continue;"));
});

Deno.test("12C.3 — legacy profiles.organization_id fallback is preserved", () => {
  // Legacy pointer query retained; only gated by membership-row existence.
  const legacyQuery = source.includes('.select("id, email, display_name, organization_id, is_active")')
    && source.includes('.eq("organization_id", organizationId)');
  assert(legacyQuery);
  assert(source.includes("for (const profile of (legacyProfilesResult.data ?? []) as OrganizationProfileRecord[]) {"));
});

Deno.test("12C.3 — unrelated Organization population is not loaded", () => {
  // No unbounded profiles / memberships scans.
  assert(!/\.from\("profiles"\)\s*\.select\([^)]*\)\s*;/.test(source));
  assert(!source.includes('.from("organization_memberships")\n    .select("*")'));
});

Deno.test("12C.3 — AdminUserRow response contract is unchanged", () => {
  const expected = [
    "row_kind:",
    "user_id:",
    "display_name:",
    "email:",
    "status:",
    "org_role:",
    "workspace_count:",
    "workspace_names:",
    "invitation_state:",
    "invitation_workspace_name:",
  ];
  const iface = source.slice(source.indexOf("interface AdminUserRow"), source.indexOf("interface WorkspaceAccess"));
  for (const field of expected) assert(iface.includes(field), `missing ${field}`);
  // No membership internals leak into the row contract.
  assertEquals(iface.includes("tenant_id"), false);
  assertEquals(iface.includes("membership"), false);
});

Deno.test("12C.3 — preserved behaviors remain present", () => {
  assert(source.includes("assertBrowserSessionOnly"));
  assert(source.includes('callerClient.rpc("is_org_admin"'));
  assert(source.includes("async function ensureOrgProfile("));
  assert(source.includes("async function reconcileOrganizationInvitations("));
  assert(source.includes('row_kind: "pending_invitation"'));
  assert(source.includes('adminClient.rpc("btpm_decrypt"'));
  assert(source.includes('status: profile.is_active === false ? "deactivated" : "active"'));
});

/**
 * Portfolio-12C.3-C1 — profile display-name encryption context correction.
 *
 * profiles.display_name is encrypted under the profile row's OWN
 * profiles.organization_id, not the requested directory Organization. A failed
 * or null decryption must resolve to null so downstream auth-metadata / email
 * fallbacks apply; ciphertext must never be returned.
 */
const profileDecryptBlock = source.slice(
  source.indexOf("// Decrypt display_name for each profile"),
  source.indexOf("// Decrypt workspace names"),
);

Deno.test("12C.3-C1 — profile display_name decrypts under the profile's own Organization", () => {
  assert(profileDecryptBlock.includes("_org_id: p.organization_id,"));
  // The requested directory Organization is never used as profile decrypt context.
  assertEquals(profileDecryptBlock.includes("_org_id: organizationId,"), false);
});

Deno.test("12C.3-C1 — canonical member with a differing legacy profile Organization still decrypts", () => {
  // Decryption context is derived per profile row, so a canonical member whose
  // legacy profile Organization differs is decrypted under that profile's Org.
  assert(profileDecryptBlock.includes("if (!p.organization_id)"));
  assert(profileDecryptBlock.includes("_ciphertext: p.display_name,"));
  assert(profileDecryptBlock.includes("_org_id: p.organization_id,"));
});

Deno.test("12C.3-C1 — null/failed decryption never preserves the encrypted raw value", () => {
  assert(profileDecryptBlock.includes("const resolved = (data as string | null) ?? null;"));
  assert(profileDecryptBlock.includes("if (resolved === null)"));
  assert(profileDecryptBlock.includes("return { ...p, display_name: null };"));
  assert(profileDecryptBlock.includes("} catch {\n        return { ...p, display_name: null };"));
  // The old ciphertext-preserving fallback is gone.
  assertEquals(profileDecryptBlock.includes("?? p.display_name"), false);
});

Deno.test("12C.3-C1 — NULL-organization profiles never expose a protected envelope", () => {
  assert(source.includes('const BTPM_PROTECTED_VALUE_PREFIX = "btpmenc:";'));
  assert(source.includes("function isBtpmProtectedValue(value: string): boolean {"));
  assert(profileDecryptBlock.includes("isBtpmProtectedValue(p.display_name)"));
  assert(profileDecryptBlock.includes("return isProtectedEnvelope ? { ...p, display_name: null } : p;"));
});

Deno.test("12C.3-C1 — auth-metadata / email fallback remains available downstream", () => {
  assert(source.includes("display_name: profile.display_name ?? getAuthDisplayName(authUser)"));
  assert(source.includes("function getAuthDisplayName("));
});

Deno.test("12C.3-C1 — workspace-name decryption stays scoped to the requested Organization", () => {
  const workspaceBlock = source.slice(
    source.indexOf("// Decrypt workspace names"),
    source.indexOf("return {\n    authUsers:"),
  );
  assert(workspaceBlock.includes("_ciphertext: w.name,"));
  assert(workspaceBlock.includes("_org_id: organizationId,"));
});
