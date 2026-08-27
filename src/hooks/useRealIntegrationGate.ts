import { useActiveContext } from "@/context/ActiveContextProvider";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 4D.8G — Non-production real-integration gate.
 *
 * Diagnostic pages that call real Edge Function integrations (OpenAI,
 * Microsoft Graph, etc.) must be blocked in non-production organizations.
 * Backend-authoritative via `assert_environment_action_allowed`.
 */
export function useRealIntegrationGate() {
  const { activeOrganization, isLoading } = useActiveContext();
  const isNonProd =
    !!activeOrganization && activeOrganization.environmentRole !== "production";

  async function assertAllowed(reason: string): Promise<void> {
    if (!activeOrganization) throw new Error("No active organization");
    const { error } = await supabase.rpc("assert_environment_action_allowed", {
      _organization_id: activeOrganization.id,
      _action: "real_integration",
      _reason: reason,
    });
    if (error) {
      throw new Error(
        "Real integrations are disabled in non-production environments.",
      );
    }
  }

  return {
    activeOrganization,
    isLoading,
    isNonProd,
    blockedMessage:
      "Real integrations are disabled in non-production environments.",
    assertAllowed,
  };
}
