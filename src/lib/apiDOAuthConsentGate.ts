/**
 * UX-GAP.2B2 — Frontend reader for the accepted OAuth → BTPM business-consent
 * gate resolver (`public.get_api_d_oauth_consent_gate`, UX-GAP.2B1/C1).
 *
 * Identity correlation is exact: the caller supplies the OAuth client
 * identifier returned by Supabase (`data.client.id`) verbatim. Display name,
 * redirect URI, Tenant, Organization, Workspace and heuristics are never used.
 *
 * The reader performs no table access, no write and no browser storage. Any
 * RPC error or malformed payload collapses to a single bounded unavailable
 * condition — raw Supabase/database errors are never surfaced.
 */
import { supabase } from "@/integrations/supabase/client";
import { sanitizeApiDClientKey } from "@/lib/apiDConsent";

export type ApiDOAuthConsentGate =
  | { eligible: false }
  | {
      eligible: true;
      clientKey: string;
      acknowledged: boolean;
    };

/** Bounded, non-disclosing failure marker for the gate read. */
export const API_D_OAUTH_GATE_UNAVAILABLE = "oauth_consent_gate_unavailable";

const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]/;

/**
 * Validate the Supabase-returned OAuth client identifier as the canonical
 * value expected by the accepted resolver: string, non-empty, already trimmed,
 * already lowercase, free of ASCII control characters. Deliberately imposes no
 * UUID rule, no maximum length, no regex format, no normalization and no
 * truncation — the exact value is passed onward.
 */
export function sanitizeOAuthClientId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0) return null;
  if (raw !== raw.trim()) return null;
  if (raw !== raw.toLowerCase()) return null;
  if (CONTROL_CHAR_REGEX.test(raw)) return null;
  return raw;
}

function parseGate(raw: unknown): ApiDOAuthConsentGate {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(API_D_OAUTH_GATE_UNAVAILABLE);
  }
  const obj = raw as Record<string, unknown>;
  if (obj.eligible === false) return { eligible: false };
  if (obj.eligible !== true) throw new Error(API_D_OAUTH_GATE_UNAVAILABLE);

  const clientKey = sanitizeApiDClientKey(obj.client_key);
  if (!clientKey) throw new Error(API_D_OAUTH_GATE_UNAVAILABLE);
  if (typeof obj.acknowledged !== "boolean") {
    throw new Error(API_D_OAUTH_GATE_UNAVAILABLE);
  }
  return { eligible: true, clientKey, acknowledged: obj.acknowledged };
}

/**
 * Call exactly `public.get_api_d_oauth_consent_gate` with the exact OAuth
 * client identifier. Throws the bounded unavailable error on any RPC failure
 * or malformed payload.
 */
export async function getApiDOAuthConsentGate(
  oauthClientId: string,
): Promise<ApiDOAuthConsentGate> {
  const clientId = sanitizeOAuthClientId(oauthClientId);
  if (!clientId) throw new Error(API_D_OAUTH_GATE_UNAVAILABLE);

  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>)("get_api_d_oauth_consent_gate", {
    _oauth_client_id: clientId,
  });

  if (error) throw new Error(API_D_OAUTH_GATE_UNAVAILABLE);
  return parseGate(data);
}
