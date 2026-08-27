import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  RoadmapCalendarFiltersPopover,
  type RoadmapCalendarFilters,
} from "./RoadmapCalendarFiltersPopover";

export type RmViewMode = "month" | "year";

interface Props {
  viewMode: RmViewMode;
  periodLabel: string;
  filters: RoadmapCalendarFilters;
  activeFilterCount: number;
  onViewMode: (m: RmViewMode) => void;
  onFiltersChange: (f: RoadmapCalendarFilters) => void;
  onClearFilters: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function RoadmapCalendarToolbar({
  viewMode,
  periodLabel,
  filters,
  activeFilterCount,
  onViewMode,
  onFiltersChange,
  onClearFilters,
  onPrev,
  onNext,
  onToday,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-md p-2 bg-card">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrev} aria-label="Previous period">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={onToday}>
          Today
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNext} aria-label="Next period">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm font-medium text-foreground tabular-nums">{periodLabel}</span>
      </div>

      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && onViewMode(v as RmViewMode)}
          className="h-8"
        >
          <ToggleGroupItem value="year" className="h-8 px-3 text-xs">Year</ToggleGroupItem>
          <ToggleGroupItem value="month" className="h-8 px-3 text-xs">Month</ToggleGroupItem>
        </ToggleGroup>

        <RoadmapCalendarFiltersPopover
          filters={filters}
          activeFilterCount={activeFilterCount}
          onChange={onFiltersChange}
          onClear={onClearFilters}
        />
      </div>
    </div>
  );
}
