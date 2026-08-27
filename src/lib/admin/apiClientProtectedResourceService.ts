/**
 * UX-MCP-ADMIN.2 — Narrow Platform Admin writer for the API-client protected
 * resource assignment.
 *
 * The browser NEVER controls the audience URI. It submits only the bounded
 * administrative resource selection; the accepted Edge Function
 * `platform-api-client-protected-resource` resolves the canonical BTPM MCP
 * audience server-side and performs persistence plus audit atomically through
 * the service-role-only RPC.
 *
 * This module must never call that RPC directly and must never write
 * `public.api_clients`. Backend failures are normalized into bounded frontend
 * errors; raw Supabase / PostgREST / database error text is never surfaced.
 */
import { supabase } from "@/integrations/supabase/client";

export const API_CLIENT_PROTECTED_RESOURCE_FUNCTION =
  "platform-api-client-protected-resource" as const;

export type ApiClientProtectedResourceType = "none" | "btpm_mcp";

/** Normalizes an unknown backend value into the bounded administrative state. */
export function normalizeProtectedResourceType(
  value: unknown,
): ApiClientProtectedResourceType {
  return value === "btpm_mcp" ? "btpm_mcp" : "none";
}

export async function setApiClientProtectedResource(
  apiClientId: string,
  resourceType: ApiClientProtectedResourceType,
): Promise<void> {
  if (typeof apiClientId !== "string" || apiClientId.trim().length === 0) {
    throw new Error("Protected resource could not be saved.");
  }
  if (resourceType !== "none" && resourceType !== "btpm_mcp") {
    throw new Error("Protected resource could not be saved.");
  }

  const { data, error } = await supabase.functions.invoke(
    API_CLIENT_PROTECTED_RESOURCE_FUNCTION,
    {
      body: {
        api_client_id: apiClientId,
        resource_type: resourceType,
      },
    },
  );

  if (error || !data) {
    // Deliberately bounded: never expose provider or database error text.
    throw new Error("Protected resource could not be saved.");
  }
}
