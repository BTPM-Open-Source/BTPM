// Phase 4D.14A.5A — Canonical Tenant Integration test-result recorder wrapper.
//
// Thin Edge-Function-only wrapper around the canonical DB recorder function
// `public.record_tenant_integration_test_result`. That DB function is the
// single source of truth for updating the existing test-status fields
// (last_tested_at / last_success_at / last_error_at / last_error_message)
// and for emitting the `tested` audit row.
//
// This wrapper NEVER:
//   - writes to any table directly
//   - creates a duplicate test-history table
//   - mutates status / is_enabled / configuration / secret readiness
//   - accepts raw provider error text (only a bounded safe code)
//   - logs secret material, tokens, Vault IDs, or fingerprints
//
// Persistence failure is a soft error: callers must NOT let it override the
// real connection-test outcome. Callers should log only the fixed category
// `test_result_persistence_failed` and continue.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type TenantIntegrationTestResult = "success" | "failure" | "blocked";

export interface RecordTestResultArgs {
  integrationId: string;
  organizationId: string | null;
  actorUserId: string | null;
  result: TenantIntegrationTestResult;
  /** Fixed classification token. Never raw provider text. */
  safeErrorCode?: string | null;
  functionName: string;
  requestId: string;
}

/**
 * Bounded classification-token shape. The DB layer also validates, but we
 * pre-normalize here so the recorder never rejects the row.
 */
export function normalizeSafeErrorCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 80) return "test_result_unclassified";
  if (!/^[a-z0-9_]+$/.test(trimmed)) return "test_result_unclassified";
  return trimmed;
}

/**
 * Record a compact test outcome for a Tenant integration. Never throws;
 * returns `{ ok, code }` so callers can log persistence failures without
 * altering the real test result.
 */
export async function recordTenantIntegrationTestResult(
  service: SupabaseClient,
  args: RecordTestResultArgs,
): Promise<{ ok: boolean; code?: string }> {
  try {
    const safeCode = args.result === "success"
      ? null
      : normalizeSafeErrorCode(args.safeErrorCode ?? null);
    const { error } = await service.rpc(
      "record_tenant_integration_test_result",
      {
        _integration_id: args.integrationId,
        _organization_id: args.organizationId,
        _actor_user_id: args.actorUserId,
        _result: args.result,
        _safe_error_code: safeCode,
        _function_name: args.functionName,
        _request_id: args.requestId,
      } as any,
    );
    if (error) return { ok: false, code: "test_result_persistence_failed" };
    return { ok: true };
  } catch {
    return { ok: false, code: "test_result_persistence_failed" };
  }
}
