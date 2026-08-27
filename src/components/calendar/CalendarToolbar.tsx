import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CalendarFiltersPopover, type CalendarFilters } from "./CalendarFiltersPopover";

export type ViewMode = "year" | "month";
/** Kept for back-compat with renderers; derived from filters.presentationMode. */
export type DisplayMode = "schedule" | "milestones";

interface Props {
  viewMode: ViewMode;
  filters: CalendarFilters;
  defaultFilters: CalendarFilters;
  periodLabel: string;
  activeFilterCount: number;
  onViewMode: (v: ViewMode) => void;
  onFiltersChange: (f: CalendarFilters) => void;
  onClearFilters: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function CalendarToolbar({
  viewMode, filters, defaultFilters, periodLabel, activeFilterCount,
  onViewMode, onFiltersChange, onClearFilters,
  onPrev, onNext, onToday,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 border border-border rounded-md bg-card">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onPrev} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={onToday}>Today</Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onNext} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="text-sm font-semibold text-foreground min-w-[160px]">{periodLabel}</div>

      <div className="ml-auto flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <ToggleGroup type="single" size="sm" value={viewMode} onValueChange={(v) => v && onViewMode(v as ViewMode)}>
            <ToggleGroupItem value="month" aria-label="Month">Month</ToggleGroupItem>
            <ToggleGroupItem value="year" aria-label="Year">Year</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <CalendarFiltersPopover
          filters={filters}
          defaultFilters={defaultFilters}
          activeFilterCount={activeFilterCount}
          onChange={onFiltersChange}
          onClear={onClearFilters}
        />
      </div>
    </div>
  );
}
