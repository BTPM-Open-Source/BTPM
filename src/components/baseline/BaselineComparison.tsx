import { computeVariance, formatVarianceDays, varianceTone, formatDate, varianceLabel } from "@/lib/baselineUtils";
import { Badge } from "@/components/ui/badge";
import { Lock, Pencil, GitCompare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  currentStart: string | null | undefined;
  currentEnd: string | null | undefined;
  baselineStart: string | null | undefined;
  baselineEnd: string | null | undefined;
  isBaselined: boolean;
  addedAfterBaseline?: boolean;
  /** Compact = single horizontal row for detail headers. Default = 3-column block. */
  compact?: boolean;
  className?: string;
}

/**
 * Three-column readout: Current plan · Baseline · Variance.
 * The single source of truth for how baseline is presented to users.
 */
export function BaselineComparison({
  currentStart, currentEnd, baselineStart, baselineEnd,
  isBaselined, addedAfterBaseline, compact, className,
}: Props) {
  const variance = computeVariance(currentStart, currentEnd, baselineStart, baselineEnd);
  const showBaseline = isBaselined && (baselineStart || baselineEnd);

  if (compact) {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs", className)}>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Pencil className="h-3 w-3" />
          <span>Current</span>
          <span className="font-medium text-foreground">
            {formatDate(currentStart)} → {formatDate(currentEnd)}
          </span>
        </span>
        {showBaseline ? (
          <>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Lock className="h-3 w-3" />
              <span>Baseline</span>
              <span className="font-medium text-foreground">
                {formatDate(baselineStart)} → {formatDate(baselineEnd)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <GitCompare className="h-3 w-3" />
              <span>Variance</span>
              <span className={cn("font-mono font-medium", varianceTone(variance.endDays))}
                title={varianceLabel(variance.endDays)}>
                {formatVarianceDays(variance.endDays)}
              </span>
            </span>
          </>
        ) : addedAfterBaseline ? null : (
          <span className="text-muted-foreground italic">No baseline approved</span>
        )}
        {addedAfterBaseline && isBaselined && (
          <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-wide">
            <Sparkles className="h-3 w-3" /> Added after baseline
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-3 sm:grid-cols-3 text-xs", className)}>
      <Column
        icon={<Pencil className="h-3.5 w-3.5" />}
        label="Current plan"
        sublabel="Editable"
        start={currentStart}
        end={currentEnd}
      />
      <Column
        icon={<Lock className="h-3.5 w-3.5" />}
        label="Baseline"
        sublabel={isBaselined ? "Frozen reference" : "Not yet approved — preview"}
        start={showBaseline ? baselineStart : currentStart}
        end={showBaseline ? baselineEnd : currentEnd}
        muted={!showBaseline}
        preview={!showBaseline && !!(currentStart || currentEnd)}
      />
      <div className="rounded-md border border-border p-2.5 bg-muted/30">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <GitCompare className="h-3.5 w-3.5" />
          <span className="font-medium">Variance</span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Current vs baseline</div>
        {showBaseline ? (
          <div className="mt-1.5 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Start</span>
              <span className={cn("font-mono", varianceTone(variance.startDays))}>
                {formatVarianceDays(variance.startDays)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">End</span>
              <span className={cn("font-mono font-semibold", varianceTone(variance.endDays))}
                title={varianceLabel(variance.endDays)}>
                {formatVarianceDays(variance.endDays)}
              </span>
            </div>
          </div>

        ) : (
          <div className="mt-1.5 text-muted-foreground italic">—</div>
        )}
        {addedAfterBaseline && isBaselined && (
          <div className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Added after baseline
          </div>
        )}
      </div>
    </div>
  );
}

function Column({
  icon, label, sublabel, start, end, muted, preview,
}: { icon: React.ReactNode; label: string; sublabel: string; start: string | null | undefined; end: string | null | undefined; muted?: boolean; preview?: boolean; }) {
  const showAsMuted = muted && !preview;
  return (
    <div className={cn(
      "rounded-md border p-2.5",
      preview ? "border-dashed border-border bg-muted/20" : "border-border",
      !preview && (muted ? "bg-muted/10" : "bg-background"),
    )}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}<span className="font-medium">{label}</span>
        {preview && (
          <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px] uppercase tracking-wide">Preview</Badge>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</div>
      <div className="mt-1.5 space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Start</span>
          <span className={cn("font-medium", showAsMuted ? "text-muted-foreground" : "text-foreground")}>{formatDate(start)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">End</span>
          <span className={cn("font-medium", showAsMuted ? "text-muted-foreground" : "text-foreground")}>{formatDate(end)}</span>
        </div>
      </div>
      {preview && (
        <div className="mt-2 text-[10px] text-muted-foreground italic leading-snug">
          Approving will freeze the current plan as baseline.
        </div>
      )}
    </div>
  );
}
