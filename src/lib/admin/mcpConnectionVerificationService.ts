/**
 * UX-GAP.1B2 — Narrow Platform Admin reader for durable MCP connection
 * verification evidence.
 *
 * Reads ONLY the accepted, Platform-Super-Admin-restricted RPC
 * `public.api_g_5_10_get_mcp_connection_verification`. It performs no table
 * read, no write, and no mutation of any kind. The RPC result is strictly
 * validated and fails closed as "unavailable" (thrown) so the UI can keep
 * "unable to read evidence" distinct from "no evidence exists".
 *
 * Raw Supabase / PostgREST / SQL / authorization errors are never surfaced.
 */
import { supabase } from "@/integrations/supabase/client";

export interface McpConnectionVerification {
  readonly verified: boolean;
  readonly lastSuccessfulAuthenticationAt: string | null;
}

export const MCP_CONNECTION_VERIFICATION_RPC =
  "api_g_5_10_get_mcp_connection_verification" as const;

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  return Number.isFinite(new Date(value).getTime());
}

/**
 * Strictly validates the RPC payload. Returns `null` when the shape or the
 * verified/timestamp consistency contract is violated.
 */
export function parseMcpConnectionVerification(
  payload: unknown,
): McpConnectionVerification | null {
  if (!Array.isArray(payload) || payload.length !== 1) return null;
  const row = payload[0];
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;

  const verified = record.verified;
  if (typeof verified !== "boolean") return null;

  const timestamp = record.last_successful_authentication_at;
  if (timestamp !== null && typeof timestamp !== "string") return null;

  if (verified) {
    if (!isValidTimestamp(timestamp)) return null;
    return Object.freeze({ verified: true, lastSuccessfulAuthenticationAt: timestamp });
  }

  if (timestamp !== null) return null;
  return Object.freeze({ verified: false, lastSuccessfulAuthenticationAt: null });
}

/**
 * Reads verification evidence for one API client. Throws a bounded, non-
 * disclosing error when the evidence cannot be read.
 */
export async function getMcpConnectionVerification(
  apiClientId: string,
): Promise<McpConnectionVerification> {
  if (typeof apiClientId !== "string" || apiClientId.trim().length === 0) {
    throw new Error("MCP connection verification is unavailable.");
  }

  const { data, error } = await supabase.rpc(MCP_CONNECTION_VERIFICATION_RPC, {
    _api_client_id: apiClientId,
  });

  if (error) {
    // Deliberately bounded: never expose provider or database error text.
    throw new Error("MCP connection verification is unavailable.");
  }

  const parsed = parseMcpConnectionVerification(data);
  if (!parsed) {
    throw new Error("MCP connection verification is unavailable.");
  }
  return parsed;
}
