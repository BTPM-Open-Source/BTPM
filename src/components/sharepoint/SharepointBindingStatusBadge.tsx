/**
 * SP.3a — Status badge for project SharePoint bindings.
 *
 * Wording is deliberately honest:
 * - "Not validated" for unvalidated states (no live tenant check yet)
 * - Never claim a folder exists or is accessible.
 */

import { Badge } from "@/components/ui/badge";
import type { SharepointProjectBindingStatus } from "@/lib/sharepointBindingTypes";

interface Props {
  status: SharepointProjectBindingStatus;
}

const STATUS_META: Record<
  SharepointProjectBindingStatus,
  { label: string; className: string }
> = {
  linked_unvalidated: {
    label: "Linked · Not validated",
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

export function SharepointBindingStatusBadge({ status }: Props) {
  const meta = STATUS_META[status] ?? {
    label: status ? `Unknown (${status})` : "Unknown",
    className: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}
