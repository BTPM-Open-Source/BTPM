/**
 * SP.3b — Status badge for workspace SharePoint bindings.
 *
 * Wording mirrors the project badge but reflects workspace-level statuses.
 * "Validated" appears only after a successful live Graph check.
 */

import { Badge } from "@/components/ui/badge";
import type { SharepointWorkspaceBindingStatus } from "@/lib/sharepointBindingTypes";

interface Props {
  status: SharepointWorkspaceBindingStatus;
}

const STATUS_META: Record<
  SharepointWorkspaceBindingStatus,
  { label: string; className: string }
> = {
  configured_unvalidated: {
    label: "Configured · Not validated",
    className: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  },
  validated: {
    label: "Validated",
    className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  },
  invalid: {
    label: "Invalid binding",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
  disabled: {
    label: "Disabled",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export function SharepointWorkspaceBindingStatusBadge({ status }: Props) {
  const meta =
    STATUS_META[status] ?? {
      label: `Unknown (${String(status ?? "n/a")})`,
      className: "bg-muted text-muted-foreground border-border",
    };
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}
