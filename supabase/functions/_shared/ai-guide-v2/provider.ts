// AI-GUIDE.V2 provider — transport-only.
//
// Phase 4D.14A.8C.2B: this module no longer speaks HTTP directly. It
// composes the structured-JSON chat request body and delegates the actual
// POST to the canonical Tenant AI chat-completions transport
// (`postTenantAiChatCompletion`). The transport supplies `providerModel`
// to the wire — this module NEVER sends model IDs, Azure deployment names,
// URLs, or Authorization headers itself.
//
// Rules preserved from the pre-cutover behavior:
//   - JSON schema attempt, then JSON object fallback (both providers).
//   - Additional Azure plain-JSON fallback (no response_format).
//   - Safe response normalization + error normalization.
//   - Never logs API keys, Authorization headers, prompts, raw provider
//     bodies, or model IDs.
//   - Returned/debug model is `runtime.canonicalModel`. Provider labels
//     remain `openai | azure` for downstream telemetry.

import type { GuideTextProviderRuntimeConfig } from "../guideTextProviderRuntime.ts";
import { postTenantAiChatCompletion } from "../tenantAiChatCompletionsClient.ts";
import { getOpenAiChatBodyTraits } from "./openai-model-traits.ts";

export interface GuideV2ProviderConfig {
  provider: "openai" | "azure" | "none";
  model: string | null;
  configured: boolean;
}

export interface GuideV2JsonCallArgs {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  requestId?: string;
  // Explicit request-scoped runtime configuration. When omitted, the call
  // is treated as "provider not configured" and returns the standard
  // deterministic fallback contract used by unit tests. Runtime callers
  // (Guide chat / trace / smoke) MUST always supply this.
  providerRuntime?: GuideTextProviderRuntimeConfig | null;
}

export type GuideV2JsonCallResult =
  | {
      ok: true;
      json: unknown;
      raw_text: string;
      provider: "openai" | "azure";
      model: string;
      used_structured_output: boolean;
      elapsed_ms: number;
    }
  | {
      ok: false;
      error_code:
        | "v2_provider_not_configured"
        | "v2_provider_request_failed"
        | "v2_provider_invalid_json"
        | "v2_provider_empty_response";
      provider: "openai" | "azure" | "none";
      http_status?: number;
      elapsed_ms: number;
    };

function providerLabel(
  p: "openai" | "azure_openai",
): "openai" | "azure" {
  return p === "openai" ? "openai" : "azure";
}

/**
 * Derive the {provider, model, configured} view from an explicit runtime
 * config. When no runtime is supplied, returns "none / not configured".
 * The `model` field always exposes the canonical BTPM model — never the
 * Azure deployment name.
 */
export function getGuideV2ProviderConfig(
  runtime?: GuideTextProviderRuntimeConfig | null,
): GuideV2ProviderConfig {
  if (!runtime) return { provider: "none", model: null, configured: false };
  return {
    provider: providerLabel(runtime.provider),
    model: runtime.canonicalModel,
    configured: true,
  };
}

export async function callStructuredJson(
  args: GuideV2JsonCallArgs,
): Promise<GuideV2JsonCallResult> {
  const started = Date.now();
  const runtime = args.providerRuntime ?? null;
  if (!runtime) {
    return {
      ok: false,
      error_code: "v2_provider_not_configured",
      provider: "none",
      elapsed_ms: Date.now() - started,
    };
  }

  const label = providerLabel(runtime.provider);
  const temperature = args.temperature ?? 0;
  const maxTokens = args.maxOutputTokens ?? 600;
  const messages = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ];

  // Body compatibility is derived from the canonical model (never the Azure
  // deployment name), and applies EQUALLY to OpenAI and Azure OpenAI.
  // Reasoning-tier canonical models (o1/o3/o4/gpt-5*) require
  // `max_completion_tokens` and reject a custom `temperature` on both
  // providers. Older non-reasoning canonical models keep `max_tokens` +
  // configured `temperature`.
  const traits = getOpenAiChatBodyTraits(runtime.canonicalModel);
  const buildBase = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      messages,
      [traits.fieldName]: maxTokens,
    };
    if (!traits.omitTemperature) b.temperature = temperature;
    return b;
  };

  const schemaFormat = {
    response_format: {
      type: "json_schema" as const,
      json_schema: {
        name: args.schemaName,
        schema: args.schema,
        strict: false,
      },
    },
  };
  const objectFormat = { response_format: { type: "json_object" as const } };

  // Attempt order:
  //   1. JSON schema (both providers).
  //   2. JSON object (both providers).
  //   3. Plain JSON prompt parse (Azure only — matches prior behavior).
  const attempts: Record<string, unknown>[] = [
    { ...buildBase(), ...schemaFormat },
    { ...buildBase(), ...objectFormat },
  ];
  if (runtime.provider === "azure_openai") {
    attempts.push(buildBase());
  }

  let lastHttpStatus: number | null = null;
  let successIndex = -1;
  let successBody: Record<string, unknown> | null = null;

  for (let i = 0; i < attempts.length; i++) {
    const res = await postTenantAiChatCompletion({
      runtime,
      payload: attempts[i],
      timeoutMs: 30000,
      requestId: args.requestId,
      operation: "guide_v2_structured_json",
    });
    if (res.ok) {
      successIndex = i;
      successBody = res.json;
      lastHttpStatus = res.httpStatus;
      break;
    }
    lastHttpStatus = res.httpStatus;
  }

  if (successIndex < 0 || !successBody) {
    return {
      ok: false,
      error_code: "v2_provider_request_failed",
      provider: label,
      http_status: lastHttpStatus ?? undefined,
      elapsed_ms: Date.now() - started,
    };
  }

  const text: string =
    (successBody as { choices?: { message?: { content?: string } }[] })
      ?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) {
    return {
      ok: false,
      error_code: "v2_provider_empty_response",
      provider: label,
      elapsed_ms: Date.now() - started,
    };
  }
  const parsed = tryParseJson(text);
  if (!parsed.ok) {
    return {
      ok: false,
      error_code: "v2_provider_invalid_json",
      provider: label,
      elapsed_ms: Date.now() - started,
    };
  }
  return {
    ok: true,
    json: parsed.value,
    raw_text: text,
    provider: label,
    model: runtime.canonicalModel,
    used_structured_output: successIndex === 0,
    elapsed_ms: Date.now() - started,
  };
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return { ok: true, value: JSON.parse(fenced[1]) };
      } catch {
        /* fallthrough */
      }
    }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return { ok: true, value: JSON.parse(text.slice(first, last + 1)) };
      } catch {
        /* fallthrough */
      }
    }
    return { ok: false };
  }
}
