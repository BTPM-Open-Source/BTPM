import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Settings2 } from "lucide-react";
import { MARKER_TYPES, MARKER_TYPE_LABELS, type MarkerSemanticType } from "./roadmapCalendarUtils";

/**
 * Roadmap Calendar v2.2 — display-only options.
 *
 * Portfolio scope filters (workspace/program/status/priority) live in the top
 * Roadmap filter bar and are intentionally NOT duplicated here.
 */
export interface RoadmapCalendarFilters {
  showStarts: boolean;
  showEnds: boolean;
  showMarkers: boolean;
  markerTypes: MarkerSemanticType[];
  hideUndated: boolean;
}

export const DEFAULT_RM_CAL_FILTERS: RoadmapCalendarFilters = {
  showStarts: true,
  showEnds: true,
  showMarkers: true,
  markerTypes: [...MARKER_TYPES],
  hideUndated: true,
};

export function countActiveRmCalFilters(f: RoadmapCalendarFilters, def: RoadmapCalendarFilters): number {
  let n = 0;
  if (f.showStarts !== def.showStarts) n++;
  if (f.showEnds !== def.showEnds) n++;
  if (f.showMarkers !== def.showMarkers) n++;
  if (f.hideUndated !== def.hideUndated) n++;
  if (f.markerTypes.length !== def.markerTypes.length) n++;
  return n;
}

interface Props {
  filters: RoadmapCalendarFilters;
  activeFilterCount: number;
  onChange: (f: RoadmapCalendarFilters) => void;
  onClear: () => void;
}

export function RoadmapCalendarFiltersPopover({
  filters,
  activeFilterCount,
  onChange,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);

  const toggleMarkerType = (t: MarkerSemanticType, checked: boolean) => {
    const set = new Set(filters.markerTypes);
    if (checked) set.add(t);
    else set.delete(t);
    onChange({ ...filters, markerTypes: MARKER_TYPES.filter((x) => set.has(x)) });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          Calendar options
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Portfolio scope filters (workspace, program, status, priority) live in the top filter bar.
            </p>
          </div>

          <Separator />

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="rm-show-starts"
                checked={filters.showStarts}
                onCheckedChange={(v) => onChange({ ...filters, showStarts: !!v })}
              />
              <Label htmlFor="rm-show-starts" className="text-sm cursor-pointer">
                Show project starts
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="rm-show-ends"
                checked={filters.showEnds}
                onCheckedChange={(v) => onChange({ ...filters, showEnds: !!v })}
              />
              <Label htmlFor="rm-show-ends" className="text-sm cursor-pointer">
                Show project target ends
              </Label>
            </div>
          </section>

          <Separator />

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="rm-show-markers"
                checked={filters.showMarkers}
                onCheckedChange={(v) => onChange({ ...filters, showMarkers: !!v })}
              />
              <Label htmlFor="rm-show-markers" className="text-sm cursor-pointer font-medium">
                Show key markers
              </Label>
            </div>
            <p className="text-[11px] text-muted-foreground pl-6">
              Typed phases (target end) and tasks (due date). Standard work items are excluded.
            </p>
            <div className="pl-6 grid grid-cols-2 gap-1.5 pt-1">
              {MARKER_TYPES.map((t) => {
                const checked = filters.markerTypes.includes(t);
                return (
                  <div key={t} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`rm-mt-${t}`}
                      checked={checked}
                      disabled={!filters.showMarkers}
                      onCheckedChange={(v) => toggleMarkerType(t, !!v)}
                    />
                    <Label
                      htmlFor={`rm-mt-${t}`}
                      className={`text-xs cursor-pointer ${!filters.showMarkers ? "text-muted-foreground" : ""}`}
                    >
                      {MARKER_TYPE_LABELS[t]}
                    </Label>
                  </div>
                );
              })}
            </div>
          </section>

          <Separator />

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="rm-hide-undated"
                checked={filters.hideUndated}
                onCheckedChange={(v) => onChange({ ...filters, hideUndated: !!v })}
              />
              <Label htmlFor="rm-hide-undated" className="text-sm cursor-pointer">
                Hide undated projects
              </Label>
            </div>
            <p className="text-[11px] text-muted-foreground pl-6">
              Projects with no start and no target end date are excluded.
            </p>
          </section>

          <Separator />

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
              Reset to defaults
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
