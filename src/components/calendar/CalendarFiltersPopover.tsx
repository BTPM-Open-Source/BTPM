import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Filter } from "lucide-react";
import { SEMANTIC_TYPE_VALUES, semanticTypeLabel, type SemanticType } from "@/lib/phaseTypes";

export type ObjectScope = "phase" | "task";
export type StatusValue = "planned" | "active" | "completed" | "on_hold" | "cancelled";
export type PresentationMode = "timeline" | "key_markers";

export const ALL_STATUSES: StatusValue[] = ["planned", "active", "completed", "on_hold", "cancelled"];

export interface CalendarFilters {
  /** What to show — replaces the prior top-level Schedule/Milestones toggle. */
  presentationMode: PresentationMode;
  scopes: ObjectScope[];
  semanticTypes: SemanticType[];
  statuses: StatusValue[];
  hideUndated: boolean;
}

export const DEFAULT_FILTERS: CalendarFilters = {
  presentationMode: "timeline",
  scopes: ["phase", "task"],
  semanticTypes: [...SEMANTIC_TYPE_VALUES],
  statuses: [...ALL_STATUSES],
  hideUndated: true,
};

function statusLabel(s: StatusValue): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

interface Props {
  filters: CalendarFilters;
  defaultFilters: CalendarFilters;
  activeFilterCount: number;
  onChange: (f: CalendarFilters) => void;
  onClear: () => void;
}

export function CalendarFiltersPopover({ filters, activeFilterCount, onChange, onClear }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to show</p>
            <RadioGroup
              value={filters.presentationMode}
              onValueChange={(v) => onChange({ ...filters, presentationMode: v as PresentationMode })}
              className="gap-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem id="pm-timeline" value="timeline" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="pm-timeline" className="text-sm font-medium cursor-pointer">Full timeline</Label>
                  <p className="text-xs text-muted-foreground">
                    Show full phase/task schedule spans across their planned dates.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem id="pm-keys" value="key_markers" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="pm-keys" className="text-sm font-medium cursor-pointer">Key markers only</Label>
                  <p className="text-xs text-muted-foreground">
                    Show only typed end-date markers (Milestone, Deliverable, Decision, Review).
                  </p>
                </div>
              </div>
            </RadioGroup>
          </section>

          <Separator />

          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Object scope</p>
            {[{ v: "phase" as const, l: "Phases" }, { v: "task" as const, l: "Tasks" }].map((opt) => (
              <div key={opt.v} className="flex items-center gap-2">
                <Checkbox
                  id={`scope-${opt.v}`}
                  checked={filters.scopes.includes(opt.v)}
                  onCheckedChange={() => onChange({ ...filters, scopes: toggle(filters.scopes, opt.v) })}
                />
                <Label htmlFor={`scope-${opt.v}`} className="text-sm font-normal cursor-pointer">{opt.l}</Label>
              </div>
            ))}
          </section>

          <Separator />

          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</p>
            {SEMANTIC_TYPE_VALUES.map((t) => (
              <div key={t} className="flex items-center gap-2">
                <Checkbox
                  id={`type-${t}`}
                  checked={filters.semanticTypes.includes(t)}
                  onCheckedChange={() => onChange({ ...filters, semanticTypes: toggle(filters.semanticTypes, t) })}
                />
                <Label htmlFor={`type-${t}`} className="text-sm font-normal cursor-pointer">{semanticTypeLabel(t)}</Label>
              </div>
            ))}
          </section>

          <Separator />

          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
            {ALL_STATUSES.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <Checkbox
                  id={`status-${s}`}
                  checked={filters.statuses.includes(s)}
                  onCheckedChange={() => onChange({ ...filters, statuses: toggle(filters.statuses, s) })}
                />
                <Label htmlFor={`status-${s}`} className="text-sm font-normal cursor-pointer">{statusLabel(s)}</Label>
              </div>
            ))}
          </section>

          <Separator />

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="hide-undated"
                checked={filters.hideUndated}
                onCheckedChange={(v) => onChange({ ...filters, hideUndated: v === true })}
              />
              <Label htmlFor="hide-undated" className="text-sm font-normal cursor-pointer">Hide undated items</Label>
            </div>
          </section>

          <div className="flex justify-between pt-1">
            <Button variant="ghost" size="sm" onClick={onClear}>Clear filters</Button>
            <Button variant="default" size="sm" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function countActiveFilters(filters: CalendarFilters, defaults: CalendarFilters): number {
  let n = 0;
  if (filters.presentationMode !== defaults.presentationMode) n++;
  if (filters.scopes.length !== defaults.scopes.length) n++;
  if (filters.semanticTypes.length !== defaults.semanticTypes.length) n++;
  if (filters.statuses.length !== defaults.statuses.length) n++;
  if (filters.hideUndated !== defaults.hideUndated) n++;
  return n;
}
