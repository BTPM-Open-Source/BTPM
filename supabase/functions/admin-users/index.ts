import { createClient } from "npm:@supabase/supabase-js@2";

import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface AdminUserRow {
  row_kind: "active_user" | "pending_invitation";
  user_id: string | null;
  display_name: string | null;
  email: string;
  status: "active" | "invited" | "deactivated";
  org_role: string | null;
  workspace_count: number;
  workspace_names: string[] | null;
  invitation_state: string | null;
  invitation_workspace_name: string | null;
}

interface WorkspaceAccess {
  workspace_id: string;
  workspace_name: string;
  membership_id: string;
  role: string | null;
}

interface AdminUserDetail {
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
  is_active: boolean;
  is_org_admin: boolean;
  workspaces: WorkspaceAccess[];
}

function respond(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseRequiredString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseRole(value: unknown) {
  if (typeof value !== "string") return null;
  return ["workspace_admin", "project_manager", "contributor", "viewer"].includes(value)
    ? value
    : null;
}

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? null;
}

function getAuthDisplayName(user: { user_metadata?: Record<string, unknown> } | null | undefined) {
  const fullName = user?.user_metadata?.full_name;
  return typeof fullName === "string" && fullName.trim().length > 0 ? fullName.trim() : null;
}

function getAuthOrganizationId(user: { user_metadata?: Record<string, unknown> } | null | undefined) {
  const organizationId = user?.user_metadata?.organization_id;
  return typeof organizationId === "string" && organizationId.trim().length > 0 ? organizationId.trim() : null;
}

async function ensureOrgProfile(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  email: string,
  organizationId: string,
) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("User email is missing");

  const { data: existingProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, email, organization_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw profileError;

  if (!existingProfile) {
    const { error: insertError } = await adminClient.from("profiles").insert({
      id: userId,
      email: normalizedEmail,
      organization_id: organizationId,
    });
    if (insertError) throw insertError;
    return;
  }

  if (existingProfile.organization_id && existingProfile.organization_id !== organizationId) {
    throw new Error("User already belongs to another organization");
  }

  const updates: Record<string, unknown> = {};
  if (!existingProfile.email) updates.email = normalizedEmail;
  if (!existingProfile.organization_id) updates.organization_id = organizationId;

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await adminClient
      .from("profiles")
      .update(updates)
      .eq("id", userId);
    if (updateError) throw updateError;
  }
}

interface AuthUserLike {
  id: string;
  email: string | null;
  created_at: string;
  invited_at?: string | null;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown>;
}

interface OrganizationInvitationRecord {
  id: string;
  email: string;
  status: string;
  role: string;
  workspace_id: string | null;
  expires_at: string;
  created_at: string;
}

interface OrganizationProfileRecord {
  id: string;
  email: string | null;
  display_name: string | null;
  organization_id: string | null;
  is_active: boolean;
  avatar_url?: string | null;
  created_at?: string;
}

interface WorkspaceRecord {
  id: string;
  name: string;
}

interface AdminInvitationRow {
  id: string;
  email: string;
  status: string;
  role: string;
  workspace_name: string | null;
  invited_at: string;
  expires_at: string;
  is_expired: boolean;
}

interface OrganizationMembershipRecord {
  user_id: string;
  tenant_id: string | null;
  status: string | null;
}

/**
 * Portfolio-12C.3-C1 — protected-value detection.
 *
 * BTPM Tenant-versioned ciphertext carries the 'btpmenc:' envelope prefix.
 * Such a value must never be returned to callers as a display-name fallback.
 */
const BTPM_PROTECTED_VALUE_PREFIX = "btpmenc:";

function isBtpmProtectedValue(value: string): boolean {
  return value.startsWith(BTPM_PROTECTED_VALUE_PREFIX);
}

/**
 * Portfolio-12C.3 — canonical, transition-aware Organization membership resolution.
 *
 * Mirrors public.is_org_member / public.is_user_org_member semantics:
 *  - if any organization_memberships row exists for (user, organization), that
 *    record is authoritative: the Organization membership AND the matching
 *    tenant_memberships row must both be 'active';
 *  - the legacy profiles.organization_id pointer is only a transition fallback
 *    for users with NO organization_memberships row for that Organization.
 *
 * Queries are bounded to the requested Organization and the users it references.
 * No membership internals (tenant IDs, statuses) leave this module.
 */
async function resolveCanonicalOrganizationMembership(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
) {
  const { data, error } = await adminClient
    .from("organization_memberships")
    .select("user_id, tenant_id, status")
    .eq("organization_id", organizationId);

  if (error) throw error;

  const rows = (data ?? []) as OrganizationMembershipRecord[];

  // Row existence (any status) — used to block the legacy profile fallback.
  const membershipRowUserIds = new Set(rows.map((row) => row.user_id));

  const activeOrgRows = rows.filter((row) => row.status === "active" && row.tenant_id);
  const canonicalActiveUserIds = new Set<string>();

  if (activeOrgRows.length > 0) {
    const userIds = Array.from(new Set(activeOrgRows.map((row) => row.user_id)));
    const tenantIds = Array.from(
      new Set(activeOrgRows.map((row) => row.tenant_id).filter((id): id is string => Boolean(id))),
    );

    const { data: tenantRows, error: tenantError } = await adminClient
      .from("tenant_memberships")
      .select("user_id, tenant_id, status")
      .in("user_id", userIds)
      .in("tenant_id", tenantIds);

    if (tenantError) throw tenantError;

    const activeTenantPairs = new Set(
      (tenantRows ?? [])
        .filter((row) => row.status === "active")
        .map((row) => `${row.user_id}:${row.tenant_id}`),
    );

    for (const row of activeOrgRows) {
      if (activeTenantPairs.has(`${row.user_id}:${row.tenant_id}`)) {
        canonicalActiveUserIds.add(row.user_id);
      }
    }
  }

  return { membershipRowUserIds, canonicalActiveUserIds };
}

async function loadOrganizationDirectoryData(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
) {
  const { membershipRowUserIds, canonicalActiveUserIds } =
    await resolveCanonicalOrganizationMembership(adminClient, organizationId);

  const canonicalUserIds = Array.from(canonicalActiveUserIds);

  const [
    authUsersResult,
    invitationsResult,
    legacyProfilesResult,
    canonicalProfilesResult,
    workspacesResult,
  ] = await Promise.all([
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
    adminClient
      .from("invitations")
      .select("id, email, status, role, workspace_id, expires_at, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    adminClient
      .from("profiles")
      .select("id, email, display_name, organization_id, is_active")
      .eq("organization_id", organizationId),
    canonicalUserIds.length > 0
      ? adminClient
          .from("profiles")
          .select("id, email, display_name, organization_id, is_active")
          .in("id", canonicalUserIds)
      : Promise.resolve({ data: [], error: null }),
    adminClient
      .from("workspaces")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("is_archived", false),
  ]);

  if (authUsersResult.error) throw authUsersResult.error;
  if (invitationsResult.error) throw invitationsResult.error;
  if (legacyProfilesResult.error) throw legacyProfilesResult.error;
  if (canonicalProfilesResult.error) throw canonicalProfilesResult.error;
  if (workspacesResult.error) throw workspacesResult.error;

  // Canonical members are always in-scope (even when their legacy
  // profiles.organization_id points elsewhere). Legacy-pointer profiles are
  // only in-scope when no organization_memberships row exists for that user —
  // an inactive/removed membership can never be resurrected by the pointer.
  const scopedProfilesById = new Map<string, OrganizationProfileRecord>();

  for (const profile of (canonicalProfilesResult.data ?? []) as OrganizationProfileRecord[]) {
    scopedProfilesById.set(profile.id, profile);
  }

  for (const profile of (legacyProfilesResult.data ?? []) as OrganizationProfileRecord[]) {
    if (scopedProfilesById.has(profile.id)) continue;
    if (membershipRowUserIds.has(profile.id)) continue;
    scopedProfilesById.set(profile.id, profile);
  }

  const rawProfiles = Array.from(scopedProfilesById.values());

  // Decrypt display_name for each profile using the profile row's OWN
  // encryption Organization (profiles.display_name is encrypted under
  // profiles.organization_id), never the requested directory Organization.
  // Ciphertext must never be returned as a display-name fallback.
  const decryptedProfiles = await Promise.all(
    rawProfiles.map(async (p) => {
      if (!p.display_name) return p;
      const isProtectedEnvelope = isBtpmProtectedValue(p.display_name);
      if (!p.organization_id) {
        // No valid encryption Organization is available for this profile row.
        // Preserve plainly usable values; never expose a protected envelope.
        return isProtectedEnvelope ? { ...p, display_name: null } : p;
      }
      try {
        const { data } = await adminClient.rpc("btpm_decrypt", {
          _ciphertext: p.display_name,
          _org_id: p.organization_id,
        });
        const resolved = (data as string | null) ?? null;
        if (resolved === null) {
          // Failed/null decryption: fall back to downstream identity sources.
          return { ...p, display_name: null };
        }
        return { ...p, display_name: resolved };
      } catch {
        return { ...p, display_name: null };
      }
    })
  );


  // Decrypt workspace names
  const rawWorkspaces = (workspacesResult.data ?? []) as WorkspaceRecord[];
  const decryptedWorkspaces = await Promise.all(
    rawWorkspaces.map(async (w) => {
      if (!w.name) return w;
      try {
        const { data } = await adminClient.rpc("btpm_decrypt", {
          _ciphertext: w.name,
          _org_id: organizationId,
        });
        return { ...w, name: (data as string) ?? w.name };
      } catch {
        return w;
      }
    })
  );

  return {
    authUsers: (authUsersResult.data?.users ?? []) as AuthUserLike[],
    invitations: (invitationsResult.data ?? []) as OrganizationInvitationRecord[],
    profiles: decryptedProfiles,
    workspaces: decryptedWorkspaces,
    membershipRowUserIds,
    canonicalActiveUserIds,
  };
}


async function reconcileOrganizationInvitations(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  authUsers: AuthUserLike[],
  invitations: OrganizationInvitationRecord[],
  knownProfileUserIds: Set<string>,
) {
  const pendingInvitationsByEmail = new Map<string, OrganizationInvitationRecord[]>();

  for (const invitation of invitations) {
    const email = normalizeEmail(invitation.email);
    if (!email || invitation.status !== "pending") continue;

    const existing = pendingInvitationsByEmail.get(email) ?? [];
    existing.push(invitation);
    pendingInvitationsByEmail.set(email, existing);
  }

  const reconciledInvitationIds = new Set<string>();

  for (const authUser of authUsers) {
    const email = normalizeEmail(authUser.email);
    if (!email || !authUser.last_sign_in_at) continue;

    const matchingPendingInvitations = pendingInvitationsByEmail.get(email) ?? [];
    const metadataOrganizationId = getAuthOrganizationId(authUser);
    const matchesOrganization = metadataOrganizationId === organizationId || matchingPendingInvitations.length > 0;

    if (!matchesOrganization) continue;

    for (const invitation of matchingPendingInvitations) {
      reconciledInvitationIds.add(invitation.id);
    }

    if (!knownProfileUserIds.has(authUser.id)) {
      try {
        await ensureOrgProfile(adminClient, authUser.id, email, organizationId);
        knownProfileUserIds.add(authUser.id);
      } catch (error) {
        console.error("ensureOrgProfile error for", authUser.id, error);
      }
    }
  }

  if (reconciledInvitationIds.size > 0) {
    const { error } = await adminClient
      .from("invitations")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .in("id", Array.from(reconciledInvitationIds))
      .eq("status", "pending");

    if (error) {
      console.error("Invitation reconciliation error:", error.message);
    }
  }

  return reconciledInvitationIds;
}

function applyReconciledInvitationStatus(
  invitations: OrganizationInvitationRecord[],
  reconciledInvitationIds: Set<string>,
) {
  if (reconciledInvitationIds.size === 0) return invitations;

  return invitations.map((invitation) => (
    reconciledInvitationIds.has(invitation.id) && invitation.status === "pending"
      ? { ...invitation, status: "accepted" }
      : invitation
  ));
}

async function listOrganizationUsers(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
): Promise<AdminUserRow[]> {
  const {
    authUsers,
    invitations: rawInvitations,
    profiles,
    workspaces,
    membershipRowUserIds,
    canonicalActiveUserIds,
  } = await loadOrganizationDirectoryData(
    adminClient,
    organizationId,
  );


  const knownProfileUserIds = new Set(profiles.map((profile) => profile.id));
  const reconciledInvitationIds = await reconcileOrganizationInvitations(
    adminClient,
    organizationId,
    authUsers,
    rawInvitations,
    knownProfileUserIds,
  );
  const invitations = applyReconciledInvitationStatus(rawInvitations, reconciledInvitationIds);

  const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const orgWorkspaceIds = workspaces.map((workspace) => workspace.id);

  const authUserById = new Map(authUsers.map((user) => [user.id, user]));
  const authUserByEmail = new Map(
    authUsers
      .map((user) => {
        const email = normalizeEmail(user.email);
        return email ? [email, user] as const : null;
      })
      .filter((entry): entry is readonly [string, AuthUserLike] => Boolean(entry)),
  );

  const invitationEmails = new Set(
    invitations
      .filter((invitation) => invitation.status !== "revoked")
      .map((invitation) => normalizeEmail(invitation.email))
      .filter((email): email is string => Boolean(email)),
  );

  const activeRows = new Map<string, AdminUserRow>();

  for (const profile of profiles) {
    const authUser = authUserById.get(profile.id)
      ?? (profile.email ? authUserByEmail.get(normalizeEmail(profile.email) ?? "") : undefined);
    const email = normalizeEmail(authUser?.email ?? profile.email);
    if (!email) continue;

    activeRows.set(profile.id, {
      row_kind: "active_user",
      user_id: profile.id,
      display_name: profile.display_name ?? getAuthDisplayName(authUser),
      email,
      status: profile.is_active === false ? "deactivated" : "active",
      org_role: null,
      workspace_count: 0,
      workspace_names: null,
      invitation_state: null,
      invitation_workspace_name: null,
    });
  }

  for (const authUser of authUsers) {
    const email = normalizeEmail(authUser.email);
    if (!email || activeRows.has(authUser.id)) continue;

    const isCanonicalMember = canonicalActiveUserIds.has(authUser.id);

    // A user with an organization_memberships row that is not canonically
    // active must never be resurrected via auth metadata or invitation email.
    if (!isCanonicalMember && membershipRowUserIds.has(authUser.id)) continue;

    if (!isCanonicalMember && !authUser.last_sign_in_at) continue;

    const metadataOrganizationId = getAuthOrganizationId(authUser);
    const wasInvitedToOrg = metadataOrganizationId === organizationId || invitationEmails.has(email);

    if (!isCanonicalMember && !wasInvitedToOrg) continue;


    activeRows.set(authUser.id, {
      row_kind: "active_user",
      user_id: authUser.id,
      display_name: getAuthDisplayName(authUser),
      email,
      status: "active",
      org_role: null,
      workspace_count: 0,
      workspace_names: null,
      invitation_state: null,
      invitation_workspace_name: null,
    });
  }

  const activeUserIds = Array.from(activeRows.keys());

  if (activeUserIds.length > 0) {
    const [rolesResult, membershipsResult] = await Promise.all([
      adminClient
        .from("user_roles")
        .select("user_id, role, workspace_id")
        .eq("organization_id", organizationId)
        .in("user_id", activeUserIds),
      orgWorkspaceIds.length > 0
        ? adminClient
            .from("workspace_memberships")
            .select("user_id, workspace_id")
            .in("user_id", activeUserIds)
            .in("workspace_id", orgWorkspaceIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (rolesResult.error) throw rolesResult.error;
    if (membershipsResult.error) throw membershipsResult.error;

    const orgRoleByUserId = new Map<string, string>();
    for (const role of rolesResult.data ?? []) {
      if (!role.workspace_id && !orgRoleByUserId.has(role.user_id)) {
        orgRoleByUserId.set(role.user_id, role.role);
      }
    }

    const workspaceNamesByUserId = new Map<string, string[]>();
    for (const membership of membershipsResult.data ?? []) {
      const workspaceName = workspaceNameById.get(membership.workspace_id);
      if (!workspaceName) continue;
      const existing = workspaceNamesByUserId.get(membership.user_id) ?? [];
      if (!existing.includes(workspaceName)) existing.push(workspaceName);
      workspaceNamesByUserId.set(membership.user_id, existing);
    }

    for (const [userId, row] of activeRows.entries()) {
      const workspaceNames = workspaceNamesByUserId.get(userId)?.slice().sort() ?? [];
      row.org_role = orgRoleByUserId.get(userId) ?? null;
      row.workspace_count = workspaceNames.length;
      row.workspace_names = workspaceNames.length > 0 ? workspaceNames : null;
    }
  }

  const activeEmails = new Set(
    Array.from(activeRows.values())
      .map((row) => normalizeEmail(row.email))
      .filter((email): email is string => Boolean(email)),
  );

  const pendingRows: AdminUserRow[] = [];
  const seenPendingEmails = new Set<string>();

  for (const invitation of invitations) {
    const email = normalizeEmail(invitation.email);
    if (!email || invitation.status !== "pending" || activeEmails.has(email) || seenPendingEmails.has(email)) {
      continue;
    }

    seenPendingEmails.add(email);

    const isExpired = !!invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now();

    pendingRows.push({
      row_kind: "pending_invitation",
      user_id: null,
      display_name: null,
      email,
      status: "invited",
      org_role: null,
      workspace_count: 0,
      workspace_names: null,
      invitation_state: isExpired ? "expired" : "pending",
      invitation_workspace_name: invitation.workspace_id ? workspaceNameById.get(invitation.workspace_id) ?? null : null,
    });
  }

  return [
    ...Array.from(activeRows.values()).sort((a, b) => a.email.localeCompare(b.email)),
    ...pendingRows.sort((a, b) => a.email.localeCompare(b.email)),
  ];
}

async function listOrganizationInvitations(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
): Promise<AdminInvitationRow[]> {
  const { authUsers, invitations: rawInvitations, profiles, workspaces } = await loadOrganizationDirectoryData(
    adminClient,
    organizationId,
  );

  const knownProfileUserIds = new Set(profiles.map((profile) => profile.id));
  const reconciledInvitationIds = await reconcileOrganizationInvitations(
    adminClient,
    organizationId,
    authUsers,
    rawInvitations,
    knownProfileUserIds,
  );
  const invitations = applyReconciledInvitationStatus(rawInvitations, reconciledInvitationIds);
  const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));

  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    status: invitation.status,
    role: invitation.role,
    workspace_name: invitation.workspace_id ? workspaceNameById.get(invitation.workspace_id) ?? null : null,
    invited_at: invitation.created_at,
    expires_at: invitation.expires_at,
    is_expired: !!invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now(),
  }));
}

async function getOrganizationUserDetail(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  userId: string,
): Promise<AdminUserDetail> {
  const { data: authUserResult, error: authUserError } = await adminClient.auth.admin.getUserById(userId);
  if (authUserError) throw authUserError;

  const authUser = authUserResult.user;
  if (!authUser) throw new Error("User not found");

  const email = normalizeEmail(authUser.email);

  const [profileResult, workspaceResult, orgRolesResult] = await Promise.all([
    adminClient
      .from("profiles")
      .select("id, display_name, avatar_url, email, created_at, is_active, organization_id")
      .eq("id", userId)
      .maybeSingle(),
    adminClient
      .from("workspaces")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq("is_archived", false)
      .order("name"),
    adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .is("workspace_id", null),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (workspaceResult.error) throw workspaceResult.error;
  if (orgRolesResult.error) throw orgRolesResult.error;

  const profile = profileResult.data;
  const workspaces = workspaceResult.data ?? [];
  const orgWorkspaceIds = workspaces.map((workspace) => workspace.id);
  const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));

  let inScope = profile?.organization_id === organizationId || getAuthOrganizationId(authUser) === organizationId;

  if (!inScope && email) {
    const { data: inviteMatch, error: inviteMatchError } = await adminClient
      .from("invitations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", email)
      .limit(1)
      .maybeSingle();

    if (inviteMatchError) throw inviteMatchError;
    inScope = Boolean(inviteMatch?.id);
  }

  if (!inScope) {
    throw new Error("User not found in this organization");
  }

  const [membershipsResult, workspaceRolesResult] = await Promise.all([
    orgWorkspaceIds.length > 0
      ? adminClient
          .from("workspace_memberships")
          .select("id, workspace_id")
          .eq("user_id", userId)
          .in("workspace_id", orgWorkspaceIds)
      : Promise.resolve({ data: [], error: null }),
    orgWorkspaceIds.length > 0
      ? adminClient
          .from("user_roles")
          .select("workspace_id, role")
          .eq("user_id", userId)
          .eq("organization_id", organizationId)
          .in("workspace_id", orgWorkspaceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (membershipsResult.error) throw membershipsResult.error;
  if (workspaceRolesResult.error) throw workspaceRolesResult.error;

  const workspaceRoleById = new Map<string, string>();
  for (const role of workspaceRolesResult.data ?? []) {
    if (role.workspace_id && !workspaceRoleById.has(role.workspace_id)) {
      workspaceRoleById.set(role.workspace_id, role.role);
    }
  }

  const membershipRows = (membershipsResult.data ?? [])
    .map((membership) => ({
      workspace_id: membership.workspace_id,
      workspace_name: workspaceNameById.get(membership.workspace_id) ?? "Unknown workspace",
      membership_id: membership.id,
      role: workspaceRoleById.get(membership.workspace_id) ?? null,
    }))
    .sort((a, b) => a.workspace_name.localeCompare(b.workspace_name));

  // Decrypt display_name
  let decryptedDisplayName = profile?.display_name ?? getAuthDisplayName(authUser);
  if (decryptedDisplayName && profile?.organization_id) {
    try {
      const { data } = await adminClient.rpc("btpm_decrypt", {
        _ciphertext: decryptedDisplayName,
        _org_id: profile.organization_id,
      });
      if (data) decryptedDisplayName = data as string;
    } catch { /* keep encrypted fallback */ }
  }

  // Decrypt workspace names
  const decryptedMembershipRows = await Promise.all(
    membershipRows.map(async (m) => {
      try {
        const { data } = await adminClient.rpc("btpm_decrypt", {
          _ciphertext: m.workspace_name,
          _org_id: organizationId,
        });
        return { ...m, workspace_name: (data as string) ?? m.workspace_name };
      } catch {
        return m;
      }
    })
  );

  return {
    user_id: userId,
    display_name: decryptedDisplayName,
    email: authUser.email ?? profile?.email ?? null,
    avatar_url: profile?.avatar_url ?? null,
    created_at: profile?.created_at ?? authUser.created_at,
    is_active: profile?.is_active === false ? false : true,
    is_org_admin: (orgRolesResult.data ?? []).some((role) => role.role === "org_admin"),
    workspaces: decryptedMembershipRows,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond({ ok: false, error: "Missing authorization" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return respond({ ok: false, error: "Missing Supabase configuration" });
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(callerClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = parseRequiredString(body.action);
    const organizationId = parseRequiredString(body.organization_id);

    if (!action || !organizationId) {
      return respond({ ok: false, error: "action and organization_id are required" });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);


    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller?.id) {
      return respond({ ok: false, error: "Not authenticated" });
    }

    const { data: isAdmin, error: isAdminError } = await callerClient.rpc("is_org_admin", {
      _organization_id: organizationId,
      _user_id: caller.id,
    });

    if (isAdminError) throw isAdminError;
    if (!isAdmin) {
      return respond({ ok: false, error: "Admin access required" });
    }

    if (action === "list") {
      const users = await listOrganizationUsers(adminClient, organizationId);
      return respond({ ok: true, users });
    }

    if (action === "list_invitations") {
      const invitations = await listOrganizationInvitations(adminClient, organizationId);
      return respond({ ok: true, invitations });
    }

    const userId = parseRequiredString(body.user_id);
    if (!userId) {
      return respond({ ok: false, error: "user_id is required" });
    }

    if (action === "detail") {
      const user = await getOrganizationUserDetail(adminClient, organizationId, userId);
      return respond({ ok: true, user });
    }

    const { data: authUserResult, error: authUserError } = await adminClient.auth.admin.getUserById(userId);
    if (authUserError) throw authUserError;

    const targetUser = authUserResult.user;
    const targetEmail = normalizeEmail(targetUser?.email);
    if (!targetUser || !targetEmail) {
      return respond({ ok: false, error: "Target user not found" });
    }

    await ensureOrgProfile(adminClient, userId, targetEmail, organizationId);

    if (action === "add_workspace_access") {
      const workspaceId = parseRequiredString(body.workspace_id);
      const role = parseRole(body.role);

      if (!workspaceId || !role) {
        return respond({ ok: false, error: "workspace_id and a valid workspace role are required" });
      }

      const { error: addAccessError } = await callerClient.rpc("admin_add_workspace_access", {
        _organization_id: organizationId,
        _target_user_id: userId,
        _workspace_id: workspaceId,
        _role: role,
      });

      if (addAccessError) throw addAccessError;
      return respond({ ok: true });
    }

    if (action === "set_org_admin") {
      if (typeof body.is_admin !== "boolean") {
        return respond({ ok: false, error: "is_admin must be a boolean" });
      }

      const { error: setOrgAdminError } = await callerClient.rpc("admin_set_org_admin", {
        _organization_id: organizationId,
        _target_user_id: userId,
        _is_admin: body.is_admin,
      });

      if (setOrgAdminError) throw setOrgAdminError;
      return respond({ ok: true });
    }

    return respond({ ok: false, error: "Unsupported action" });
  } catch (error) {
    console.error("admin-users error:", error);
    return respond({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  }
});