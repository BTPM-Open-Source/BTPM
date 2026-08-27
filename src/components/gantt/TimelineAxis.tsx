import type { AxisLayout } from "./useTimelineZoom";

interface Props {
  axis: AxisLayout;
  width: number;
  height: number;
  todayOffset: number | null;
}

/**
 * Two-row adaptive timeline axis. Top = major bands (month/year),
 * Bottom = minor ticks (day/week/month/quarter depending on zoom).
 * Uses semantic tokens only.
 */
export function TimelineAxis({ axis, width, height, todayOffset }: Props) {
  const majorH = Math.round(height * 0.5);
  const minorH = height - majorH;

  return (
    <div
      className="relative bg-card border-b border-border select-none"
      style={{ width, height }}
    >
      {/* Major row */}
      <div className="absolute left-0 right-0 top-0 border-b border-border/40" style={{ height: majorH }}>
        {axis.major.map((t, i) => (
          <div
            key={`maj-${i}`}
            className="absolute top-0 flex items-center px-2 text-[11px] font-semibold text-foreground/80 border-l border-border/50 truncate"
            style={{ left: t.x, width: t.width, height: majorH }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* Minor row */}
      <div className="absolute left-0 right-0" style={{ top: majorH, height: minorH }}>
        {axis.minor.map((t, i) => (
          <div
            key={`min-${i}`}
            className="absolute top-0 flex items-center justify-center px-1 text-[10px] text-muted-foreground border-l border-border/30 truncate"
            style={{ left: t.x, width: t.width, height: minorH }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* Today pill */}
      {todayOffset !== null && todayOffset >= 0 && todayOffset <= width && (
        <div
          className="absolute top-0.5 -translate-x-1/2 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-semibold text-destructive-foreground shadow-sm z-10 pointer-events-none whitespace-nowrap"
          style={{ left: todayOffset }}
        >
          Today
        </div>
      )}
    </div>
  );
}
