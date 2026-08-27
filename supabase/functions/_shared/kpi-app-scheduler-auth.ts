// BTPM — Wave C2, Step C2.11d
// Internal Signed Scheduler Invocation — secret verification helper.
//
// Responsibilities:
//   - Read KPI_APP_SCHEDULER_SECRET from the function environment.
//   - Constant-time-compare the value of the `x-scheduler-secret` request
//     header against the configured secret.
//   - Reject when:
//       * KPI_APP_SCHEDULER_SECRET is unset or empty
//       * the request header is missing
//       * the lengths differ
//       * any byte differs (constant-time)
//   - NEVER log the secret value.
//   - NEVER return the secret value in errors.
//
// This helper is intentionally tiny: it is the ONLY trust step that allows
// the scheduler orchestrator to construct a service-role client without a
// human user JWT.

export class SchedulerAuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "SchedulerAuthError";
    this.status = status;
  }
}

/**
 * Constant-time byte comparison. Both inputs MUST be the same length to
 * return true. Returns false fast on length mismatch but does not branch
 * on byte content.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify that the incoming request carries a valid `x-scheduler-secret`
 * header matching the configured `KPI_APP_SCHEDULER_SECRET` env var.
 *
 * Throws SchedulerAuthError(401) on any failure. The error message is
 * intentionally generic and never includes either the configured secret
 * or the presented header value.
 */
export function verifySchedulerSecret(req: Request): void {
  const expected = Deno.env.get("KPI_APP_SCHEDULER_SECRET") ?? "";
  if (!expected || expected.length === 0) {
    // Treat missing configuration as authorization failure. We do NOT
    // distinguish "unset" from "mismatch" externally to avoid leaking
    // server configuration state.
    throw new SchedulerAuthError("Unauthorized");
  }
  const presented = req.headers.get("x-scheduler-secret");
  if (presented === null || presented.length === 0) {
    throw new SchedulerAuthError("Unauthorized");
  }
  if (!constantTimeEqual(presented, expected)) {
    throw new SchedulerAuthError("Unauthorized");
  }
}

/**
 * Activation gate. Returns true ONLY when KPI_APP_SCHEDULER_ENABLED is
 * the literal string "true" (case-insensitive, trimmed). Any other value
 * — including unset — keeps the wrapper inert.
 */
export function isSchedulerEnabled(): boolean {
  const v = (Deno.env.get("KPI_APP_SCHEDULER_ENABLED") ?? "").trim().toLowerCase();
  return v === "true";
}
