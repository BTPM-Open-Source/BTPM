// Phase 4D.14A.5A — Transport-only OpenAI connection-test client.
//
// This module makes exactly one read-only call to
// `GET https://api.openai.com/v1/models` to prove that a supplied API key is
// accepted by OpenAI. It NEVER:
//   - generates text
//   - creates Responses or Chat Completions
//   - uses or exposes an AI model ID
//   - queries Supabase, Vault, or Tenant/Organization tables
//   - reads Global `OPENAI_API_KEY`
//   - caches credentials
//   - returns the API key or the Authorization header
//   - logs raw response bodies, model lists, or model names
//
// Safe log fields:
//   component, operation ("list_models"), host, http_status, request_id,
//   fixed result category.

export type OpenAiConnectionTestCategory =
  | "success"
  | "credential_rejected"
  | "access_forbidden"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "provider_unavailable"
  | "invalid_response";

export interface OpenAiConnectionTestResult {
  category: OpenAiConnectionTestCategory;
  httpStatus: number | null;
}

export interface OpenAiConnectionTestArgs {
  apiKey: string;
  requestId: string;
  /** Optional: allow tests to inject a mock fetch. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional: override timeout (ms). Defaults to 20_000. */
  timeoutMs?: number;
}

export const OPENAI_TEST_TIMEOUT_MS = 20_000;
export const OPENAI_TEST_HOST = "api.openai.com";
export const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const COMPONENT = "openai-connection-test";

function log(
  operation: string,
  requestId: string,
  fields: Record<string, unknown>,
) {
  const safe: Record<string, unknown> = {
    component: COMPONENT,
    operation,
    host: OPENAI_TEST_HOST,
    request_id: requestId,
  };
  for (const [k, v] of Object.entries(fields)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("authorization") ||
      lk.includes("api_key") ||
      lk.includes("token") ||
      lk.includes("secret") ||
      lk === "body" ||
      lk === "message" ||
      lk === "data" ||
      lk === "models"
    ) continue;
    safe[k] = v;
  }
  console.log(`[${COMPONENT}] ${operation}`, JSON.stringify(safe));
}

/**
 * Pure classifier for a completed HTTP response. Extracted so tests can
 * exercise every branch without staging real network responses.
 */
export function classifyOpenAiModelsResponse(input: {
  status: number;
  hasDataArray: boolean;
}): OpenAiConnectionTestCategory {
  const { status, hasDataArray } = input;
  if (status === 200) {
    return hasDataArray ? "success" : "invalid_response";
  }
  if (status === 401) return "credential_rejected";
  if (status === 403) return "access_forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "provider_unavailable";
  // Any other unexpected non-2xx (400, 404, ...) treat as provider unavailable
  // rather than credential rejected so we do not falsely accuse the operator.
  return "provider_unavailable";
}

/** Pure classifier for transport-level failures (never sees a response). */
export function classifyOpenAiTransportFailure(
  err: unknown,
): OpenAiConnectionTestCategory {
  if (err && typeof err === "object" && "name" in err) {
    const name = String((err as { name?: unknown }).name ?? "");
    if (name === "AbortError" || name === "TimeoutError") return "timeout";
  }
  return "network_error";
}

/**
 * Execute the read-only OpenAI connection test. Returns a compact result;
 * never throws.
 */
export async function testOpenAiConnection(
  args: OpenAiConnectionTestArgs,
): Promise<OpenAiConnectionTestResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? OPENAI_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(OPENAI_MODELS_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (e) {
      const category = classifyOpenAiTransportFailure(e);
      log("list_models", args.requestId, {
        result: category,
        http_status: null,
      });
      return { category, httpStatus: null };
    }
    const status = response.status;
    let hasDataArray = false;
    // Only inspect the body enough to confirm shape. Never log/return it.
    if (status === 200) {
      try {
        const parsed = (await response.json()) as unknown;
        hasDataArray = !!parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { data?: unknown }).data);
      } catch {
        hasDataArray = false;
      }
    } else {
      // Consume the body to avoid resource leaks; never log it.
      try {
        await response.text();
      } catch {
        // ignore
      }
    }
    const category = classifyOpenAiModelsResponse({ status, hasDataArray });
    log("list_models", args.requestId, {
      result: category,
      http_status: status,
    });
    return { category, httpStatus: status };
  } finally {
    clearTimeout(timer);
  }
}
