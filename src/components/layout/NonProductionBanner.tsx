import { AlertTriangle } from "lucide-react";
import { useActiveContext } from "@/context/ActiveContextProvider";

/**
 * Phase 4D.7 — App-shell non-production environment warning.
 *
 * Renders a visible but non-blocking banner whenever the active
 * Organization has environment_role = "non_production".
 * Never renders for production organizations.
 */
export function NonProductionBanner() {
  const { activeOrganization } = useActiveContext();
  if (!activeOrganization) return null;
  if (activeOrganization.environmentRole !== "non_production") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-900 dark:text-amber-200"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold uppercase tracking-wide">
        Non-production environment
      </span>
      <span className="text-amber-900/80 dark:text-amber-200/80">
        · {activeOrganization.name} · External writes and real integrations are
        disabled by default.
      </span>
    </div>
  );
}

export default NonProductionBanner;
