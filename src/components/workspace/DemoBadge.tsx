import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Visual indicator that a workspace is the BTPM Demo Workspace.
 * Read-only for non-admin users; excluded from operational reporting by default.
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className={className}>
          <Sparkles className="mr-1 h-3 w-3" />
          Demo
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs text-xs">
          Read-only example workspace for learning BTPM. Excluded from operational reporting.
          Only org admins can edit demo data.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
