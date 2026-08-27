// Phase 4D.14A.7H — canonical password-reset Organization resolver.
//
// Server-only helper (must be called with the Supabase service-role client)
// that resolves the Organization context, if any, to route a password-reset
// email through the effective Tenant SMTP integration. When no unambiguous
// Organization can be determined the caller MUST fall back to Supabase Auth's
// native `resetPasswordForEmail`.
//
// Never callable from browser code. Never returns Tenant IDs, membership
// counts, or Organization identifiers to the browser.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type PasswordResetRoute =
  | { kind: "tenant"; organizationId: string }
  | { kind: "platform_auth" };

interface MembershipRow {
  organization_id: string;
  status: string;
}

/**
 * Pure classifier — exposed for unit tests. Given the last-active
 * Organization preference and the list of the user's Organization
 * memberships, choose the canonical routing decision.
 *
 * Order:
 *   A. Valid last-active Organization (present + active membership row).
 *   B. Sole active Organization membership.
 *   C. Ambiguous / absent → platform_auth.
 */
export function classifyPasswordResetRoute(
  lastActiveOrganizationId: string | null,
  memberships: MembershipRow[] | null | undefined,
): PasswordResetRoute {
  const activeMemberships = (memberships ?? []).filter(
    (m) => m && typeof m.organization_id === "string" && m.status === "active",
  );
  const activeOrgIds = new Set(activeMemberships.map((m) => m.organization_id));

  if (
    lastActiveOrganizationId &&
    typeof lastActiveOrganizationId === "string" &&
    activeOrgIds.has(lastActiveOrganizationId)
  ) {
    return { kind: "tenant", organizationId: lastActiveOrganizationId };
  }

  if (activeOrgIds.size === 1) {
    const [only] = Array.from(activeOrgIds);
    return { kind: "tenant", organizationId: only };
  }

  return { kind: "platform_auth" };
}

/**
 * Resolve the canonical password-reset routing decision for the given user.
 * MUST be invoked with a service-role Supabase client. Returns
 * `{ kind: "platform_auth" }` on any resolution error to preserve
 * anti-enumeration behavior.
 */
export async function resolvePasswordResetOrganization(
  adminClient: SupabaseClient,
  userId: string,
): Promise<PasswordResetRoute> {
  if (!userId || typeof userId !== "string") {
    return { kind: "platform_auth" };
  }

  let lastActive: string | null = null;
  try {
    const { data, error } = await adminClient
      .from("user_active_context_preferences")
      .select("last_active_organization_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data && typeof data.last_active_organization_id === "string") {
      lastActive = data.last_active_organization_id;
    }
  } catch (_) {
    lastActive = null;
  }

  let memberships: MembershipRow[] = [];
  try {
    const { data, error } = await adminClient
      .from("organization_memberships")
      .select("organization_id,status")
      .eq("user_id", userId)
      .eq("status", "active");
    if (error || !Array.isArray(data)) {
      return { kind: "platform_auth" };
    }
    memberships = data as MembershipRow[];
  } catch (_) {
    return { kind: "platform_auth" };
  }

  if (lastActive) {
    // Extra safety: confirm the Organization row still exists.
    try {
      const { data, error } = await adminClient
        .from("organizations")
        .select("id")
        .eq("id", lastActive)
        .maybeSingle();
      if (error || !data) {
        lastActive = null;
      }
    } catch (_) {
      lastActive = null;
    }
  }

  return classifyPasswordResetRoute(lastActive, memberships);
}
