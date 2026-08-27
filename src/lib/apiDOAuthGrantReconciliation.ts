/**
 * UX-GAP.2B3A — Pre-authorization stale OAuth grant reconciliation helper.
 *
 * Reconciles the current authenticated user's existing Supabase OAuth grants
 * against the current BTPM business-policy acknowledgement state, BEFORE any
 * OAuth authorization request is evaluated.
 *
 * Correlation is exact: only `grant.client.id` is used. Client name, redirect
 * URI/URL, scopes, Tenant, Organization, Workspace and heuristics are never
 * used. Revocation happens only for an eligible, unacknowledged BTPM grant.
 *
 * No browser storage, no persistence, no raw error disclosure.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  getApiDOAuthConsentGate,
  sanitizeOAuthClientId,
} from "@/lib/apiDOAuthConsentGate";

/** Single bounded, non-disclosing failure marker for the whole helper. */
export const BTPM_OAUTH_GRANT_RECONCILIATION_UNAVAILABLE =
  "btpm_oauth_grant_reconciliation_unavailable";

export type BtpmOAuthGrantReconciliationResult = {
  revokedGrantCount: number;
  unresolvedGrantCount: number;
};

function fail(): never {
  throw new Error(BTPM_OAUTH_GRANT_RECONCILIATION_UNAVAILABLE);
}

type OAuthLike = {
  listGrants: () => Promise<{ data: unknown; error: unknown }>;
  revokeGrant: (args: { clientId: string }) => Promise<{ error: unknown }>;
};

function oauthApi(): OAuthLike {
  const oauth = (supabase.auth as unknown as { oauth?: OAuthLike }).oauth;
  if (
    !oauth ||
    typeof oauth.listGrants !== "function" ||
    typeof oauth.revokeGrant !== "function"
  ) {
    fail();
  }
  return oauth;
}

/** Extract the exact, validated client identifiers from the grants payload. */
function extractClientIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) fail();
  const ids: string[] = [];
  for (const grant of raw) {
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) fail();
    const client = (grant as Record<string, unknown>).client;
    if (!client || typeof client !== "object" || Array.isArray(client)) fail();
    const id = sanitizeOAuthClientId((client as Record<string, unknown>).id);
    if (!id) fail();
    // Duplicate client IDs are ambiguous — fail closed, never deduplicate.
    if (ids.includes(id)) fail();
    ids.push(id);
  }
  return ids;
}

/**
 * Revoke only the stale (eligible, unacknowledged) BTPM OAuth grants for the
 * current user. Processing is strictly sequential and fails closed.
 */
export async function reconcileBtpmOAuthGrantsBeforeAuthorization(): Promise<
  BtpmOAuthGrantReconciliationResult
> {
  const oauth = oauthApi();

  let listed: { data: unknown; error: unknown };
  try {
    listed = await oauth.listGrants();
  } catch {
    fail();
  }
  if (!listed || typeof listed !== "object") fail();
  if (listed.error) fail();

  const clientIds = extractClientIds(listed.data);

  let revokedGrantCount = 0;
  let unresolvedGrantCount = 0;

  for (const clientId of clientIds) {
    let gate: Awaited<ReturnType<typeof getApiDOAuthConsentGate>>;
    try {
      gate = await getApiDOAuthConsentGate(clientId);
    } catch {
      fail();
    }

    if (!gate.eligible) {
      unresolvedGrantCount += 1;
      continue;
    }
    if (gate.acknowledged) continue;

    // Only reachable for eligible === true && acknowledged === false.
    let revoked: { error: unknown };
    try {
      revoked = await oauth.revokeGrant({ clientId });
    } catch {
      fail();
    }
    if (!revoked || typeof revoked !== "object") fail();
    if (revoked.error) fail();
    revokedGrantCount += 1;
  }

  return { revokedGrantCount, unresolvedGrantCount };
}
