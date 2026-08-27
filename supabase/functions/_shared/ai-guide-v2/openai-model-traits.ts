// Phase 4D.14A.3C.2 / 4D.14A.8C.2B.1 — Chat Completions model-trait helper.
//
// Applies to BOTH the OpenAI and Azure OpenAI branches of the BTPM Guide
// text-provider transport. Trait selection is driven by the CANONICAL BTPM
// model id (never the Azure deployment name), because the underlying
// model family — not the hosting provider — is what dictates whether the
// Chat Completions body must use `max_completion_tokens` and omit a
// custom `temperature`.
//
// Reasoning-tier models (o1*, o3*, o4*, gpt-5*) reject the classic Chat
// Completions body used for GPT-4/3.5-class models on both OpenAI and
// Azure OpenAI:
//   - `max_tokens` is not accepted; the endpoint requires
//     `max_completion_tokens`.
//   - A custom `temperature` (other than the default 1) is not accepted.
//
// Sending either field to a reasoning model results in an HTTP 400
// ("Unsupported parameter") from the provider, which was breaking BTPM
// Guide when a GPT-5 variant (e.g. `gpt-5.4-mini`) was selected — on
// OpenAI directly and, after the Azure cutover, on Azure deployments
// mapped to a GPT-5 canonical model as well.


/**
 * Returns true when the given OpenAI Chat Completions model id belongs to
 * the reasoning tier (o-series or GPT-5 family) and therefore requires
 * `max_completion_tokens` instead of `max_tokens` and does not accept a
 * non-default `temperature`.
 *
 * Matching is intentionally forgiving on prefixes so future minor variants
 * (e.g. `gpt-5.5`, `o4-mini-high`) are covered without a code change:
 *   - starts with `gpt-5` (case-insensitive)
 *   - starts with `o1`, `o3`, or `o4` followed by end-of-string or `-`
 *
 * Non-OpenAI model ids and legacy GPT-4/3.5/4o ids return false.
 */
export function isOpenAiReasoningModel(model: string | null | undefined): boolean {
  if (!model) return false;
  const id = model.trim().toLowerCase();
  if (id.length === 0) return false;
  if (id.startsWith("gpt-5")) return true;
  if (/^o[134](?:$|[-_.])/.test(id)) return true;
  return false;
}

export interface OpenAiTokenLimitField {
  /** Body field name to send: `max_completion_tokens` for reasoning tier, `max_tokens` otherwise. */
  fieldName: "max_tokens" | "max_completion_tokens";
  /** True when a custom `temperature` MUST be omitted (reasoning tier). */
  omitTemperature: boolean;
}

/**
 * Trait bundle for building a Chat Completions body against `model`.
 * Callers should spread `{ [fieldName]: <n> }` and only include a
 * `temperature` field when `omitTemperature` is false.
 */
export function getOpenAiChatBodyTraits(model: string | null | undefined): OpenAiTokenLimitField {
  if (isOpenAiReasoningModel(model)) {
    return { fieldName: "max_completion_tokens", omitTemperature: true };
  }
  return { fieldName: "max_tokens", omitTemperature: false };
}
