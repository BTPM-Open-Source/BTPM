// Phase 4D.14A.3C — BTPM Guide Admin AI Settings feature-config resolver.
//
// Resolves the OpenAI text model the BTPM Guide runtime must use for a given
// Organization by reading `ai_feature_settings` (feature_key='btpm_guide')
// joined to `ai_model_registry`. There is NO fallback to `OPENAI_MODEL`,
// no hardcoded model, and no other implicit source.
//
// A valid OpenAI Guide configuration REQUIRES:
//   - settings row exists
//   - enabled = true
//   - provider = 'openai'
//   - joined registry row exists
//   - registry active = true
//   - registry provider = 'openai'
//   - non-empty registry model_id
//
// Callers get one of three outcomes:
//   1. { ok: true, provider: 'openai', model }              — valid.
//   2. throws GuideModelResolveError('btpm_guide_not_configured')      — disabled/absent/invalid.
//   3. throws GuideModelResolveError('btpm_guide_configuration_unavailable') — infrastructure failure.
//
// This module is service-role-only. It never logs model IDs, org IDs, or
// user content, and never exposes RPC/PostgREST error text.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

export type GuideModelResolveErrorCode =
  | "btpm_guide_not_configured"
  | "btpm_guide_configuration_unavailable";

export class GuideModelResolveError extends Error {
  code: GuideModelResolveErrorCode;
  constructor(code: GuideModelResolveErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GuideModelResolveError";
  }
}

const PUBLIC_MESSAGES: Record<GuideModelResolveErrorCode, string> = {
  btpm_guide_not_configured:
    "BTPM Guide is disabled or is not configured in AI Settings.",
  btpm_guide_configuration_unavailable:
    "BTPM Guide configuration is temporarily unavailable.",
};

export function toSafeGuideModelPublicError(err: unknown): {
  error: GuideModelResolveErrorCode;
  note: string;
} {
  const code: GuideModelResolveErrorCode =
    err instanceof GuideModelResolveError
      ? err.code
      : "btpm_guide_configuration_unavailable";
  return { error: code, note: PUBLIC_MESSAGES[code] };
}

export type BtpmGuideFeatureConfigResult =
  | { ok: true; provider: "openai"; model: string }
  | { ok: false; code: GuideModelResolveErrorCode };

/**
 * Pure classifier: given a raw settings row from Supabase, decide whether it
 * represents a valid enabled OpenAI Guide configuration.
 *
 * A separate error `err` (query-level failure) is treated as infrastructure
 * and mapped to `btpm_guide_configuration_unavailable`.
 */
export function classifyBtpmGuideFeatureRow(
  err: unknown,
  row:
    | {
        enabled?: boolean | null;
        provider?: string | null;
        ai_model_registry?:
          | {
              model_id?: string | null;
              provider?: string | null;
              active?: boolean | null;
            }
          | null;
      }
    | null
    | undefined,
): BtpmGuideFeatureConfigResult {
  if (err) return { ok: false, code: "btpm_guide_configuration_unavailable" };
  if (!row) return { ok: false, code: "btpm_guide_not_configured" };
  if (row.enabled !== true) return { ok: false, code: "btpm_guide_not_configured" };
  if (row.provider !== "openai")
    return { ok: false, code: "btpm_guide_not_configured" };
  const reg = row.ai_model_registry;
  if (
    !reg ||
    reg.active !== true ||
    reg.provider !== "openai" ||
    typeof reg.model_id !== "string" ||
    reg.model_id.trim().length === 0
  ) {
    return { ok: false, code: "btpm_guide_not_configured" };
  }
  return { ok: true, provider: "openai", model: reg.model_id.trim() };
}

/**
 * Read `ai_feature_settings` (btpm_guide) for the given Organization using a
 * service-role client and classify the result. Throws
 * GuideModelResolveError on any non-ok outcome.
 */
export async function resolveBtpmGuideFeatureConfigForOrg(args: {
  organizationId: string;
}): Promise<{ provider: "openai"; model: string }> {
  const orgId = args?.organizationId;
  if (!orgId) {
    throw new GuideModelResolveError(
      "btpm_guide_configuration_unavailable",
      PUBLIC_MESSAGES.btpm_guide_configuration_unavailable,
    );
  }
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new GuideModelResolveError(
      "btpm_guide_configuration_unavailable",
      PUBLIC_MESSAGES.btpm_guide_configuration_unavailable,
    );
  }
  let data: any = null;
  let err: unknown = null;
  try {
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const res = await admin
      .from("ai_feature_settings")
      .select(
        "enabled, provider, ai_model_registry:model_registry_id(model_id, provider, active)",
      )
      .eq("organization_id", orgId)
      .eq("feature_key", "btpm_guide")
      .maybeSingle();
    data = res.data;
    err = res.error;
  } catch (e) {
    err = e;
  }
  const cls = classifyBtpmGuideFeatureRow(err, data);
  if (!cls.ok) {
    throw new GuideModelResolveError(cls.code, PUBLIC_MESSAGES[cls.code]);
  }
  return { provider: cls.provider, model: cls.model };
}
