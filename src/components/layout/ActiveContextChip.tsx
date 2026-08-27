import { useNavigate } from "react-router-dom";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Building2, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ReactNode } from "react";

/**
 * Phase 4D.3 / 4D.3A — Compact active context chip in sidebar footer.
 * Renders explicit loading / error / no-access / missing-context states so
 * the tenant/organization/workspace indicator is never silently invisible.
 */
export default function ActiveContextChip() {
  const {
    isLoading,
    isError,
    errorMessage,
    hasAccess,
    activeTenant,
    activeOrganization,
    availableTenantCount,
    availableOrganizationCount,
    requiresTenantSelection,
    requiresOrganizationSelection,
  } = useActiveContext();
  const navigate = useNavigate();

  // A. Loading
  if (isLoading) {
    return (
      <ChipShell>
        <div className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground/70">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading context…
        </div>
      </ChipShell>
    );
  }

  // D. RPC error
  if (isError) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <ChipShell>
              <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle className="h-3 w-3" />
                Context unavailable
              </div>
            </ChipShell>
          </TooltipTrigger>
          {errorMessage && (
            <TooltipContent side="right" className="max-w-xs text-xs break-words">
              {errorMessage}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    );
  }

  // C. No access
  if (!hasAccess) {
    return (
      <ChipShell onClick={() => navigate("/select-context")}>
        <div className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground/80">
          <AlertTriangle className="h-3 w-3" />
          No active organization
        </div>
      </ChipShell>
    );
  }

  // E. Selection required
  if (requiresTenantSelection || requiresOrganizationSelection || !activeTenant || !activeOrganization) {
    return (
      <ChipShell onClick={() => navigate("/select-context")}>
        <div className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground/80">
          <Building2 className="h-3 w-3" />
          {requiresTenantSelection ? "Select tenant" : "Select organization"}
          <ChevronsUpDown className="ml-auto h-3 w-3" />
        </div>
      </ChipShell>
    );
  }

  // B. Valid context (tenant + organization only — workspace is shown by the sidebar selector)
  const canSwitch = availableTenantCount > 1 || availableOrganizationCount > 1;

  const envKind = (activeOrganization.kind ?? "production").toUpperCase();
  const isNonProd = activeOrganization.environmentRole === "non_production";

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ChipShell onClick={() => navigate("/select-context")}>
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3 w-3 shrink-0 text-sidebar-foreground/70" />
              <span className="truncate text-[11px] font-semibold text-sidebar-foreground">
                {activeTenant.name}
              </span>
              {canSwitch && (
                <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 text-sidebar-foreground/60" />
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate text-[11px] text-sidebar-foreground/90">
                {activeOrganization.name}
              </span>
              {isNonProd && (
                <Badge
                  variant="outline"
                  className="ml-1 h-4 border-amber-400/70 bg-amber-400/10 px-1 text-[9px] font-semibold uppercase text-amber-200"
                >
                  {envKind === "PRODUCTION" ? "NON-PROD" : envKind}
                </Badge>
              )}
            </div>
          </ChipShell>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          <div className="font-semibold">{activeTenant.name}</div>
          <div>{activeOrganization.name}</div>
          <div className="mt-1 opacity-70">
            {canSwitch ? "Click to switch organization" : "Click to view current context"}
          </div>
        </TooltipContent>
      </Tooltip>


    </TooltipProvider>
  );
}

function ChipShell({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  const interactive = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      aria-label="Active tenant and organization"
      className={cn(
        "w-full rounded-md border border-sidebar-border/70 bg-sidebar-accent/40 px-2 py-2 text-left transition-colors",
        interactive ? "hover:bg-sidebar-accent/70 cursor-pointer" : "cursor-default",
      )}
    >
      {children}
    </button>
  );
}
