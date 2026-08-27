// Phase 4D.14A.8A — Transport-only Azure OpenAI connection-test client.
//
// Makes exactly one read-only call to `GET {baseUrl}/models` using the
// `api-key: <api key>` header (Azure OpenAI v1 API). NEVER:
//   - generates content or embeddings
//   - selects a model or deployment
//   - queries Supabase, Vault, or Tenant tables
//   - reads Global `AZURE_OPENAI_*` env
//   - caches credentials
//   - returns/logs the api key, endpoint, response body, or model list
//
// Safe log fields: component, operation ("list_models"), http_status,
// request_id, fixed result category.

export type AzureOpenAiConnectionTestCategory =
  | "success"
  | "credential_rejected"
  | "permission_denied"
  | "endpoint_not_found"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "service_unavailable"
  | "response_invalid";

export interface AzureOpenAiConnectionTestResult {
  category: AzureOpenAiConnectionTestCategory;
  httpStatus: number | null;
}

export interface AzureOpenAiConnectionTestArgs {
  baseUrl: string;
  apiKey: string;
  requestId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const AZURE_OPENAI_TEST_TIMEOUT_MS = 20_000;
const COMPONENT = "azure-openai-connection-test";

function log(
  operation: string,
  requestId: string,
  fields: Record<string, unknown>,
) {
  const safe: Record<string, unknown> = {
    component: COMPONENT,
    operation,
    request_id: requestId,
  };
  for (const [k, v] of Object.entries(fields)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("authorization") ||
      lk.includes("api_key") ||
      lk.includes("api-key") ||
      lk.includes("token") ||
      lk.includes("secret") ||
      lk === "body" ||
      lk === "message" ||
      lk === "data" ||
      lk === "models" ||
      lk === "endpoint" ||
      lk === "base_url" ||
      lk === "host"
    ) continue;
    safe[k] = v;
  }
  console.log(`[${COMPONENT}] ${operation}`, JSON.stringify(safe));
}

/** Pure classifier for a completed HTTP response. */
export function classifyAzureModelsResponse(input: {
  status: number;
  hasArrayShape: boolean;
}): AzureOpenAiConnectionTestCategory {
  const { status, hasArrayShape } = input;
  if (status >= 200 && status < 300) {
    return hasArrayShape ? "success" : "response_invalid";
  }
  if (status === 401) return "credential_rejected";
  if (status === 403) return "permission_denied";
  if (status === 404) return "endpoint_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "service_unavailable";
  return "service_unavailable";
}

/** Pure classifier for transport-level failures (no HTTP response). */
export function classifyAzureTransportFailure(
  err: unknown,
): AzureOpenAiConnectionTestCategory {
  if (err && typeof err === "object" && "name" in err) {
    const name = String((err as { name?: unknown }).name ?? "");
    if (name === "AbortError" || name === "TimeoutError") return "timeout";
  }
  return "network_error";
}

/** Execute the read-only Azure OpenAI connection test. Never throws. */
export async function testAzureOpenAiConnection(
  args: AzureOpenAiConnectionTestArgs,
): Promise<AzureOpenAiConnectionTestResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? AZURE_OPENAI_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${args.baseUrl.replace(/\/+$/, "")}/models`;
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          "api-key": args.apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (e) {
      const category = classifyAzureTransportFailure(e);
      log("list_models", args.requestId, {
        result: category,
        http_status: null,
      });
      return { category, httpStatus: null };
    }
    const status = response.status;
    let hasArrayShape = false;
    if (status >= 200 && status < 300) {
      try {
        const parsed = (await response.json()) as unknown;
        // Accept either { data: [...] } (OpenAI-compat) or a top-level array.
        if (Array.isArray(parsed)) hasArrayShape = true;
        else if (
          parsed && typeof parsed === "object" &&
          Array.isArray((parsed as { data?: unknown }).data)
        ) hasArrayShape = true;
      } catch {
        hasArrayShape = false;
      }
    } else {
      try {
        await response.text();
      } catch {
        // ignore
      }
    }
    const category = classifyAzureModelsResponse({ status, hasArrayShape });
    log("list_models", args.requestId, {
      result: category,
      http_status: status,
    });
    return { category, httpStatus: status };
  } finally {
    clearTimeout(timer);
  }
}
