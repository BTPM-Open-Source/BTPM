import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SiblingPagerProps = {
  prevTo: string | null;
  nextTo: string | null;
  prevLabel: string;
  nextLabel: string;
  /** Optional react-router state to forward (preserves returnTo/from semantics). */
  prevState?: unknown;
  nextState?: unknown;
  /** Hide entirely when there is only one (or zero) item. Defaults to false (render disabled). */
  hideWhenSingleton?: boolean;
  totalCount?: number;
  className?: string;
};

/**
 * Compact contextual previous/next sibling pager.
 * - Pure UI; ordering is computed by the caller from canonical reads.
 * - Disabled state when no neighbour exists; never invents new routes.
 */
export function SiblingPager({
  prevTo,
  nextTo,
  prevLabel,
  nextLabel,
  prevState,
  nextState,
  hideWhenSingleton = false,
  totalCount,
  className,
}: SiblingPagerProps) {
  if (hideWhenSingleton && (totalCount ?? 0) <= 1) return null;

  const baseBtn = "h-8 w-8";

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {prevTo ? (
        <Button asChild variant="ghost" size="icon" className={baseBtn} aria-label={prevLabel}>
          <Link to={prevTo} state={prevState as any} replace={false}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="icon" className={baseBtn} disabled aria-label={prevLabel} aria-disabled="true">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}
      {nextTo ? (
        <Button asChild variant="ghost" size="icon" className={baseBtn} aria-label={nextLabel}>
          <Link to={nextTo} state={nextState as any} replace={false}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="icon" className={baseBtn} disabled aria-label={nextLabel} aria-disabled="true">
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/** Pure helper: returns {prev, next} ids around currentId in an ordered list. */
export function neighbours<T extends { id: string }>(items: T[], currentId: string | undefined) {
  if (!currentId) return { prev: null as T | null, next: null as T | null, index: -1 };
  const idx = items.findIndex((i) => i.id === currentId);
  return {
    prev: idx > 0 ? items[idx - 1] : null,
    next: idx >= 0 && idx < items.length - 1 ? items[idx + 1] : null,
    index: idx,
  };
}
