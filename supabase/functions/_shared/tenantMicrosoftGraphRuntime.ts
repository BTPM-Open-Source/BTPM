// Phase 4D.14A.6B — Canonical Tenant Microsoft Graph runtime bootstrap
// used by evidence-read Edge Functions (Decision Case AI brief,
// evidence diagnostic, Data Package bundle, Roadmap Story).
//
// Per invocation:
//   1. Resolve the effective Tenant Graph credential via the canonical
//      resolver (fails closed; NEVER falls back to Global M365_*).
//   2. Acquire ONE application access token.
//   3. Return the token + runtime + a stable request id for reuse
//      across every Graph file read in the invocation.
//
// Never queries Supabase or Vault beyond what the resolver does.
// Never caches tokens across invocations. Never returns credentials.

import {
  resolveTenantMicrosoftGraphRuntimeConfig,
  toSafeMicrosoftGraphPublicError,
  TenantMicrosoftGraphError,
  type MicrosoftGraphRuntimeConfig,
} from "./tenantMicrosoftGraph.ts";
import {
  acquireMicrosoftGraphToken,
  toSafeGraphTokenAcquisitionPublicError,
} from "./microsoftGraphClient.ts";

export interface ResolveAndAcquireArgs {
  organizationId: string;
  functionName: string;
  reason: string;
  requestId?: string;
}

export type ResolveAndAcquireResult =
  | {
    ok: true;
    accessToken: string;
    requestId: string;
    runtime: MicrosoftGraphRuntimeConfig;
  }
  | {
    ok: false;
    publicError: {
      error:
        | "microsoft_graph_not_configured"
        | "microsoft_graph_access_blocked"
        | "microsoft_graph_configuration_invalid"
        | "microsoft_graph_configuration_unavailable";
      note: string;
    };
  };

export async function resolveAndAcquireTenantMicrosoftGraph(
  args: ResolveAndAcquireArgs,
): Promise<ResolveAndAcquireResult> {
  const requestId = args.requestId ?? crypto.randomUUID();
  let runtime: MicrosoftGraphRuntimeConfig;
  try {
    runtime = await resolveTenantMicrosoftGraphRuntimeConfig({
      organizationId: args.organizationId,
      action: "real_integration",
      functionName: args.functionName,
      reason: args.reason,
      requestId,
    });
  } catch (e) {
    if (!(e instanceof TenantMicrosoftGraphError)) {
      console.log("tenant_microsoft_graph_runtime_unexpected", {
        component: args.functionName,
      });
    }
    return { ok: false, publicError: toSafeMicrosoftGraphPublicError(e) };
  }

  const acquired = await acquireMicrosoftGraphToken({ runtime, requestId });
  if (acquired.category !== "success" || !acquired.accessToken) {
    return {
      ok: false,
      publicError: toSafeGraphTokenAcquisitionPublicError(acquired.category),
    };
  }
  return {
    ok: true,
    accessToken: acquired.accessToken,
    requestId,
    runtime,
  };
}
