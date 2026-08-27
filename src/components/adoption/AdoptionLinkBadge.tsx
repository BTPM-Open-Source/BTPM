/**
 * CM.7C — Compact Adoption badge for canonical views.
 * Renders "Adoption" or "Adoption · <Initiative>". Pure presentation.
 */
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AdoptionLinkBadge } from "@/hooks/useProjectAdoptionLinkBadges";

interface Props {
  badge: AdoptionLinkBadge | undefined | null;
  className?: string;
  /** When true, omits the icon. */
  iconless?: boolean;
}

export function AdoptionLinkBadge({ badge, className, iconless }: Props) {
  if (!badge) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-[10px] py-0 h-5 border-primary/40 text-primary bg-primary/5",
        className,
      )}
      title={badge.label}
    >
      {!iconless && <Sparkles className="h-3 w-3" />}
      <span className="truncate max-w-[180px]">{badge.label}</span>
    </Badge>
  );
}
