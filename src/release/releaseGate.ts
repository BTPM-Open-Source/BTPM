/**
 * Browser release gate (Wave B).
 *
 * On startup, compares the embedded BUILD_VERSION with the last applied build
 * recorded in localStorage. On mismatch:
 *   - clears BTPM-owned local UI state (view-state, saved-views, release keys)
 *   - clears the React Query cache
 *   - PRESERVES Supabase auth/session storage
 *   - records the new applied build
 *   - performs a one-time hard reload (guarded against loops)
 *
 * On match: no-op.
 *
 * Conventions:
 *   - All BTPM-owned browser keys MUST live under the `btpm:` namespace.
 *   - This gate clears only `btpm:view-state:v1:*`, `btpm:saved-views:v1:*`,
 *     and `btpm:release:*` (excluding the applied-build pointer itself).
 *   - It NEVER clears Supabase auth keys or performs sign-out.
 */
import { BUILD_VERSION } from "./releaseMetadata.generated";
import { queryClient } from "@/lib/queryClient";

const APPLIED_BUILD_KEY = "btpm:release:applied-build";
const RELOAD_GUARD_KEY = "btpm:release:reload-guard";

const CLEAR_PREFIXES = ["btpm:view-state:v1:", "btpm:saved-views:v1:"];
const RELEASE_PREFIX = "btpm:release:";

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function clearBtpmLocalState(ls: Storage) {
  const toRemove: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (!key) continue;
    if (CLEAR_PREFIXES.some((p) => key.startsWith(p))) {
      toRemove.push(key);
      continue;
    }
    // Clear all release keys EXCEPT the applied-build pointer (we just set it).
    if (key.startsWith(RELEASE_PREFIX) && key !== APPLIED_BUILD_KEY && key !== RELOAD_GUARD_KEY) {
      toRemove.push(key);
    }
  }
  for (const k of toRemove) {
    try { ls.removeItem(k); } catch { /* ignore */ }
  }
}

async function safelyUnregisterServiceWorkers() {
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch {
    /* no-op: SW may not exist; that's fine */
  }
}

/**
 * Run the release gate. Returns true if the app should continue booting,
 * false if a hard reload was triggered (caller should abort render).
 */
export function runReleaseGate(): boolean {
  const ls = safeLocalStorage();
  if (!ls) return true; // SSR or storage blocked — nothing to gate.

  let applied: string | null = null;
  try { applied = ls.getItem(APPLIED_BUILD_KEY); } catch { applied = null; }

  if (applied === BUILD_VERSION) {
    // Matched build — clear any leftover reload guard and continue.
    try { ls.removeItem(RELOAD_GUARD_KEY); } catch { /* ignore */ }
    return true;
  }

  // Mismatch (or first load with no applied build).
  // Reload guard: never reload twice in a row for the same target build.
  let guard: string | null = null;
  try { guard = ls.getItem(RELOAD_GUARD_KEY); } catch { guard = null; }

  // Record the new applied build BEFORE clearing/reloading so we don't loop.
  try { ls.setItem(APPLIED_BUILD_KEY, BUILD_VERSION); } catch { /* ignore */ }

  // Clear BTPM-owned UI state. Auth keys are NOT in our prefix set.
  clearBtpmLocalState(ls);

  // Clear React Query cache (in-memory) — safe before render.
  try { queryClient.clear(); } catch { /* ignore */ }

  // First-load case: no previous applied build → just record and continue,
  // no reload necessary (nothing to invalidate visually).
  if (applied === null) {
    return true;
  }

  // Guard against reload loops.
  if (guard === BUILD_VERSION) {
    // Already attempted a reload for this build target — give up gracefully.
    return true;
  }

  try { ls.setItem(RELOAD_GUARD_KEY, BUILD_VERSION); } catch { /* ignore */ }

  // Best-effort SW cleanup, then reload.
  void safelyUnregisterServiceWorkers().finally(() => {
    try {
      const ss = safeSessionStorage();
      // Optional: drop transient session-only UI state. Keep narrow.
      if (ss) {
        // No BTPM session keys defined yet; reserved for future use.
      }
    } catch { /* ignore */ }
    try { window.location.reload(); } catch { /* ignore */ }
  });

  return false;
}
