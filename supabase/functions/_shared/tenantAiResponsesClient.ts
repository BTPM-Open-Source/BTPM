// Phase 4D.14A.8D.1 — Canonical Tenant AI Responses API transport.
//
// Provider-neutral helper that enqueues and polls Responses API requests
// against either OpenAI or Azure OpenAI using a resolved
// `TenantAiTextRuntime`. Callers supply a payload; this helper forces
// `model`, `background`, and `store` from the runtime and its own contract.
//
// This helper:
//   - never resolves Tenant settings
//   - never queries Supabase or Vault
//   - never reads Global env provider settings
//   - never chooses or falls back between providers
//   - never logs or returns API keys, Authorization headers, endpoints,
//     deployment names, prompts, payloads, or raw provider bodies
//
// It is intentionally NOT imported by any production Edge Function in this
// step. 4D.14A.8D.1 only establishes the transport contract for future
// Decision Case and Roadmap Story cutovers.

import type { TenantAiTextRuntime } from "./tenantAiTextRuntime.ts";

export type TenantAiResponsesFailureCategory =
  | "credential_rejected"
  | "permission_denied"
  | "request_rejected"
  | "endpoint_not_found"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "service_unavailable"
  | "response_invalid";

export type TenantAiResponseState =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "incomplete"
  | "unknown";

interface TenantAiResponsesResultBase {
  provider: TenantAiTextRuntime["provider"];
  canonicalModel: string;
}

export type TenantAiResponsesEnqueueResult =
  & TenantAiResponsesResultBase
  & (
    | {
      ok: true;
      httpStatus: number;
      responseId: string;
      state: TenantAiResponseState;
    }
    | {
      ok: false;
      httpStatus: number | null;
      category: TenantAiResponsesFailureCategory;
    }
  );

export type TenantAiResponsesStatusResult =
  & TenantAiResponsesResultBase
  & (
    | {
      ok: true;
      httpStatus: number;
      responseId: string;
      state: TenantAiResponseState;
      /** Present only when state === "completed"; provider `model` stripped. */
      body: Record<string, unknown> | null;
    }
    | {
      ok: false;
      httpStatus: number | null;
      category: TenantAiResponsesFailureCategory;
    }
  );

export interface EnqueueTenantAiResponseArgs {
  runtime: TenantAiTextRuntime;
  /**
   * Responses API body EXCLUDING `model`, `background`, and `store`.
   * Any of those fields supplied by the caller are discarded.
   */
  payload: Record<string, unknown>;
  timeoutMs?: number;
  requestId?: string;
  operation?: string;
  fetchImpl?: typeof fetch;
}

export interface GetTenantAiResponseStatusArgs {
  runtime: TenantAiTextRuntime;
  responseId: string;
  timeoutMs?: number;
  requestId?: string;
  operation?: string;
  fetchImpl?: typeof fetch;
}

function classifyHttpStatus(status: number): TenantAiResponsesFailureCategory {
  if (status === 401) return "credential_rejected";
  if (status === 403) return "permission_denied";
  if (status === 404) return "endpoint_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "service_unavailable";
  if (status >= 400) return "request_rejected";
  return "service_unavailable";
}

function classifyTransportFailure(
  err: unknown,
): TenantAiResponsesFailureCategory {
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  return "network_error";
}

function buildAuthHeaders(runtime: TenantAiTextRuntime): HeadersInit {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  if (runtime.authMode === "bearer") {
    base["Authorization"] = `Bearer ${runtime.apiKey}`;
  } else {
    base["api-key"] = runtime.apiKey;
  }
  return base;
}

function clampTimeout(ms: number | undefined): number {
  const raw = typeof ms === "number" && Number.isFinite(ms) ? ms : 30000;
  return Math.max(1000, Math.min(120000, raw));
}

async function drainDiscard(res: Response): Promise<void> {
  try {
    await res.text();
  } catch {
    /* ignore */
  }
}

function normalizeState(raw: unknown): TenantAiResponseState {
  if (
    raw === "queued" || raw === "in_progress" || raw === "completed" ||
    raw === "failed" || raw === "cancelled" || raw === "incomplete"
  ) {
    return raw;
  }
  return "unknown";
}

function stripProviderModel(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if ("model" in body) {
    const { model: _model, ...rest } = body;
    return rest;
  }
  return body;
}

/**
 * Enqueue a Responses API request. Forces `background=true`, `store=true`,
 * and `model = runtime.providerModel`. Caller values for those fields are
 * discarded.
 */
export async function enqueueTenantAiResponse(
  args: EnqueueTenantAiResponseArgs,
): Promise<TenantAiResponsesEnqueueResult> {
  const { runtime, payload } = args;
  const timeoutMs = clampTimeout(args.timeoutMs);
  const operation = args.operation ?? "tenant_ai_responses_enqueue";
  const reqId = args.requestId ?? "-";
  const doFetch = args.fetchImpl ?? fetch;

  const url = `${runtime.baseUrl}/responses`;
  // Strip caller-supplied overrides for controlled fields.
  const {
    model: _forbiddenModel,
    background: _forbiddenBg,
    store: _forbiddenStore,
    ...safePayload
  } = payload as Record<string, unknown>;
  const body = {
    ...safePayload,
    model: runtime.providerModel,
    background: true,
    store: true,
  };
  const headers = buildAuthHeaders(runtime);

  const base: TenantAiResponsesResultBase = {
    provider: runtime.provider,
    canonicalModel: runtime.canonicalModel,
  };

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const category = classifyTransportFailure(err);
    console.error(
      `[tenant-ai-responses] transport_failed op=${operation} provider=${runtime.provider} req=${reqId} category=${category}`,
    );
    return { ...base, ok: false, httpStatus: null, category };
  }

  if (!response.ok) {
    const category = classifyHttpStatus(response.status);
    await drainDiscard(response);
    console.error(
      `[tenant-ai-responses] http_error op=${operation} provider=${runtime.provider} status=${response.status} req=${reqId} category=${category}`,
    );
    return { ...base, ok: false, httpStatus: response.status, category };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      ...base,
      ok: false,
      httpStatus: response.status,
      category: "response_invalid",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ...base,
      ok: false,
      httpStatus: response.status,
      category: "response_invalid",
    };
  }
  const obj = parsed as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== "string" || id.length === 0) {
    return {
      ...base,
      ok: false,
      httpStatus: response.status,
      category: "response_invalid",
    };
  }
  return {
    ...base,
    ok: true,
    httpStatus: response.status,
    responseId: id,
    state: normalizeState(obj.status),
  };
}

/**
 * Poll a previously enqueued Response by id. Returns a completed body only
 * when `state === "completed"`, with the provider `model` field removed.
 */
export async function getTenantAiResponseStatus(
  args: GetTenantAiResponseStatusArgs,
): Promise<TenantAiResponsesStatusResult> {
  const { runtime, responseId } = args;
  const timeoutMs = clampTimeout(args.timeoutMs);
  const operation = args.operation ?? "tenant_ai_responses_status";
  const reqId = args.requestId ?? "-";
  const doFetch = args.fetchImpl ?? fetch;

  const url = `${runtime.baseUrl}/responses/${encodeURIComponent(responseId)}`;
  const headers = buildAuthHeaders(runtime);

  const base: TenantAiResponsesResultBase = {
    provider: runtime.provider,
    canonicalModel: runtime.canonicalModel,
  };

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const category = classifyTransportFailure(err);
    console.error(
      `[tenant-ai-responses] transport_failed op=${operation} provider=${runtime.provider} req=${reqId} category=${category}`,
    );
    return { ...base, ok: false, httpStatus: null, category };
  }

  if (!response.ok) {
    const category = classifyHttpStatus(response.status);
    await drainDiscard(response);
    console.error(
      `[tenant-ai-responses] http_error op=${operation} provider=${runtime.provider} status=${response.status} req=${reqId} category=${category}`,
    );
    return { ...base, ok: false, httpStatus: response.status, category };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      ...base,
      ok: false,
      httpStatus: response.status,
      category: "response_invalid",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ...base,
      ok: false,
      httpStatus: response.status,
      category: "response_invalid",
    };
  }
  const obj = parsed as Record<string, unknown>;
  const state = normalizeState(obj.status);
  const id = typeof obj.id === "string" && obj.id.length > 0 ? obj.id : responseId;

  return {
    ...base,
    ok: true,
    httpStatus: response.status,
    responseId: id,
    state,
    body: state === "completed" ? stripProviderModel(obj) : null,
  };
}

// ---------------------------------------------------------------------------
// 4D.14A.8D.4 — Synchronous Responses transport
// ---------------------------------------------------------------------------
//
// `executeTenantAiResponse` performs a single blocking POST /responses call
// against the resolved runtime and returns the sanitized completed body.
// It is intended for admin-only diagnostic paths where the caller waits for
// the response inline rather than polling. It:
//   - forces `model = runtime.providerModel`
//   - forces `background = false` and `store = false`
//   - never retries — the caller must not receive `store=true` fallbacks
//   - discards failed provider bodies and maps to safe transport categories
//   - strips the top-level `model` field from the returned body
export type TenantAiResponsesExecuteResult =
  & TenantAiResponsesResultBase
  & (
    | {
      ok: true;
      httpStatus: number;
      body: Record<string, unknown>;
    }
    | {
      ok: false;
      httpStatus: number | null;
      category: TenantAiResponsesFailureCategory;
    }
  );

export interface ExecuteTenantAiResponseArgs {
  runtime: TenantAiTextRuntime;
  /**
   * Responses API body EXCLUDING `model`, `background`, and `store`.
   * Any of those fields supplied by the caller are discarded.
   */
  payload: Record<string, unknown>;
  timeoutMs?: number;
  requestId?: string;
  operation?: string;
  fetchImpl?: typeof fetch;
}

export async function executeTenantAiResponse(
  args: ExecuteTenantAiResponseArgs,
): Promise<TenantAiResponsesExecuteResult> {
  const { runtime, payload } = args;
  const timeoutMs = clampTimeout(args.timeoutMs);
  const operation = args.operation ?? "tenant_ai_responses_execute";
  const reqId = args.requestId ?? "-";
  const doFetch = args.fetchImpl ?? fetch;

  const url = `${runtime.baseUrl}/responses`;
  const {
    model: _forbiddenModel,
    background: _forbiddenBg,
    store: _forbiddenStore,
    ...safePayload
  } = payload as Record<string, unknown>;
  const body = {
    ...safePayload,
    model: runtime.providerModel,
    background: false,
    store: false,
  };
  const headers = buildAuthHeaders(runtime);

  const base: TenantAiResponsesResultBase = {
    provider: runtime.provider,
    canonicalModel: runtime.canonicalModel,
  };

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const category = classifyTransportFailure(err);
    console.error(
      `[tenant-ai-responses] transport_failed op=${operation} provider=${runtime.provider} req=${reqId} category=${category}`,
    );
    return { ...base, ok: false, httpStatus: null, category };
  }

  if (!response.ok) {
    const category = classifyHttpStatus(response.status);
    await drainDiscard(response);
    console.error(
      `[tenant-ai-responses] http_error op=${operation} provider=${runtime.provider} status=${response.status} req=${reqId} category=${category}`,
    );
    return { ...base, ok: false, httpStatus: response.status, category };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      ...base,
      ok: false,
      httpStatus: response.status,
      category: "response_invalid",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ...base,
      ok: false,
      httpStatus: response.status,
      category: "response_invalid",
    };
  }
  return {
    ...base,
    ok: true,
    httpStatus: response.status,
    body: stripProviderModel(parsed as Record<string, unknown>),
  };
}

