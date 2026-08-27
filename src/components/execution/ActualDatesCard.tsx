import { Activity, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/baselineUtils";

interface Props {
  actualStart: string | null | undefined;
  actualEnd: string | null | undefined;
  /** When true, render the "derived from children" hint (phase/project). */
  derived?: boolean;
  derivedNote?: string;
  className?: string;
}

/**
 * Compact "Actual" card matching the visual language of BaselineComparison's
 * Current/Baseline columns. This is execution truth — separate from plan + baseline.
 */
export function ActualDatesCard({ actualStart, actualEnd, derived, derivedNote, className }: Props) {
  const empty = !actualStart && !actualEnd;
  return (
    <div
      className={cn(
        "rounded-md border border-border p-2.5 bg-background text-xs",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Activity className="h-3.5 w-3.5" />
        <span className="font-medium">Actual</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        {derived ? "Derived from child execution" : "What really happened"}
      </div>
      <div className="mt-1.5 space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Start</span>
          <span className={cn("font-medium", actualStart ? "text-foreground" : "text-muted-foreground")}>
            {formatDate(actualStart) || "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">End</span>
          <span className={cn("font-medium", actualEnd ? "text-foreground" : "text-muted-foreground")}>
            {formatDate(actualEnd) || "—"}
          </span>
        </div>
      </div>
      {derived && derivedNote && (
        <div className="mt-2 inline-flex items-start gap-1 text-[10px] text-muted-foreground italic leading-snug">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{derivedNote}</span>
        </div>
      )}
      {empty && !derived && (
        <div className="mt-2 text-[10px] text-muted-foreground italic">
          Record actual dates in the Execution tab.
        </div>
      )}
    </div>
  );
}
