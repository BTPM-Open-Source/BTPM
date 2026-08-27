// Phase 4D.14A.3C — Canonical active Organization resolver (Edge-only).
//
// Resolves the caller's currently active Organization via the authenticated
// user JWT and the membership-aware RPC `public.get_my_active_context()`.
//
// This helper NEVER:
//   - queries `profiles.organization_id`
//   - derives Organization from a client-supplied body value
//   - trusts a client-supplied Tenant ID
//   - uses the service-role key to bypass active-context validation
//   - logs Tenant, Organization, or user IDs
//
// It is Edge-Function-only and must not be imported into browser code.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ActiveOrganizationErrorCode =
  | "organization_context_unavailable"
  | "organization_context_resolution_failed";

export class ActiveOrganizationContextError extends Error {
  code: ActiveOrganizationErrorCode;
  constructor(code: ActiveOrganizationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ActiveOrganizationContextError";
  }
}

const PUBLIC_MESSAGES: Record<ActiveOrganizationErrorCode, string> = {
  organization_context_unavailable:
    "Select an active Organization before using BTPM Guide.",
  organization_context_resolution_failed:
    "The active Organization could not be resolved.",
};

/**
 * Pure classifier for `get_my_active_context` RPC outcomes.
 * - RPC-level error (network / db / RLS misconfiguration) => resolution_failed.
 * - RPC ok but empty organization_id => context_unavailable.
 */
export function classifyActiveOrganizationRpc(
  err: unknown,
  row: { organization_id?: string | null } | null | undefined,
):
  | { ok: true; organizationId: string }
  | { ok: false; code: ActiveOrganizationErrorCode } {
  if (err) return { ok: false, code: "organization_context_resolution_failed" };
  const orgId = row?.organization_id ?? null;
  if (!orgId || typeof orgId !== "string") {
    return { ok: false, code: "organization_context_unavailable" };
  }
  return { ok: true, organizationId: orgId };
}

/**
 * Resolve the active Organization ID for the authenticated caller.
 * MUST be called with a user-JWT-scoped Supabase client (never service role),
 * so `get_my_active_context()` runs under the caller's identity and validates
 * memberships.
 */
export async function resolveActiveOrganizationId(
  userClient: SupabaseClient,
): Promise<string> {
  let data: any = null;
  let err: unknown = null;
  try {
    const res = await userClient.rpc("get_my_active_context");
    data = res.data;
    err = res.error;
  } catch (e) {
    err = e;
  }
  const cls = classifyActiveOrganizationRpc(err, data);
  if (!cls.ok) {
    throw new ActiveOrganizationContextError(cls.code, PUBLIC_MESSAGES[cls.code]);
  }
  return cls.organizationId;
}

/**
 * Safe public error contract for callers that need to convert an
 * ActiveOrganizationContextError into a browser-safe JSON body. Never
 * contains identifiers, RPC text, or internal details.
 */
export function toSafeActiveOrganizationPublicError(err: unknown): {
  error: ActiveOrganizationErrorCode;
  note: string;
} {
  const code: ActiveOrganizationErrorCode =
    err instanceof ActiveOrganizationContextError
      ? err.code
      : "organization_context_resolution_failed";
  return { error: code, note: PUBLIC_MESSAGES[code] };
}
