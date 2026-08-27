// BTPM — Wave C3, Step C3.8
// Automatic KPI Snapshot Capture Scheduler — secret + activation gate.
//
// This helper is intentionally SEPARATE from the C2 KPI App scheduler
// auth helper (`kpi-app-scheduler-auth.ts`). The two schedulers run on
// different cadences (snapshot 05:00 UTC, KPI App 06:00 UTC) and must
// be operator-controlled independently:
//   - KPI_SNAPSHOT_SCHEDULER_SECRET   (this helper)
//   - KPI_SNAPSHOT_SCHEDULER_ENABLED  (this helper)
//   - KPI_APP_SCHEDULER_SECRET        (C2 helper — UNRELATED)
//   - KPI_APP_SCHEDULER_ENABLED       (C2 helper — UNRELATED)
//
// Mixing the two would let one operator toggle accidentally activate
// both subsystems. Keeping them disjoint is a deliberate authority-
// boundary decision.
//
// Hard rules:
//   - Constant-time secret comparison.
//   - Never log the secret value.
//   - Never return the secret value in errors.
//   - Treat "unset/empty configured secret" identically to "header
//     mismatch" externally to avoid leaking server config state.

export class SnapshotSchedulerAuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "SnapshotSchedulerAuthError";
    this.status = status;
  }
}

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
 * Verify the incoming request's `x-snapshot-scheduler-secret` header
 * matches the configured `KPI_SNAPSHOT_SCHEDULER_SECRET` env var via
 * constant-time comparison. Throws SnapshotSchedulerAuthError(401) on
 * any failure. Generic error message — never includes either side of
 * the comparison.
 */
export function verifySnapshotSchedulerSecret(req: Request): void {
  const expected = Deno.env.get("KPI_SNAPSHOT_SCHEDULER_SECRET") ?? "";
  if (!expected || expected.length === 0) {
    throw new SnapshotSchedulerAuthError("Unauthorized");
  }
  const presented = req.headers.get("x-snapshot-scheduler-secret");
  if (presented === null || presented.length === 0) {
    throw new SnapshotSchedulerAuthError("Unauthorized");
  }
  if (!constantTimeEqual(presented, expected)) {
    throw new SnapshotSchedulerAuthError("Unauthorized");
  }
}

/**
 * Activation gate. Returns true ONLY when KPI_SNAPSHOT_SCHEDULER_ENABLED
 * equals the literal string "true" (case-insensitive, trimmed). Any
 * other value — including unset — keeps the wrapper inert.
 */
export function isSnapshotSchedulerEnabled(): boolean {
  const v = (Deno.env.get("KPI_SNAPSHOT_SCHEDULER_ENABLED") ?? "")
    .trim()
    .toLowerCase();
  return v === "true";
}
