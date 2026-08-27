import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface RoadmapMultiSelectOption {
  id: string;
  label: string;
  hint?: string;
}

interface Props {
  label: string;
  options: RoadmapMultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  emptyText?: string;
  /** Trigger label when selected list is empty. Defaults to "All". */
  allLabel?: string;
  /** Width hint for the trigger. */
  triggerClassName?: string;
}

/**
 * Roadmap-specific multi-select filter.
 *
 * - Empty selection = "All" (no filter applied)
 * - Searchable
 * - Compact trigger displays selection summary
 *
 * Intentionally Roadmap-scoped — not a general-purpose framework.
 */
export function RoadmapMultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  disabled,
  emptyText = "No options",
  allLabel = "All",
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const triggerSummary = useMemo(() => {
    if (selected.length === 0) return allLabel;
    if (selected.length === 1) {
      const found = options.find((o) => o.id === selected[0]);
      return found?.label ?? "1 selected";
    }
    return `${selected.length} selected`;
  }, [selected, options, allLabel]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const isDisabled = disabled || options.length === 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDisabled}
            className={cn(
              "h-8 justify-between gap-2 text-xs font-normal min-w-[160px]",
              triggerClassName,
            )}
          >
            <span className="truncate">
              {options.length === 0 ? emptyText : triggerSummary}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {selected.length > 0 && (
                <X
                  className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                  onClick={clear}
                  aria-label={`Clear ${label}`}
                />
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} className="h-9" />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => {
                  const isSelected = selectedSet.has(opt.id);
                  return (
                    <CommandItem
                      key={opt.id}
                      value={`${opt.label} ${opt.hint ?? ""}`}
                      onSelect={() => toggle(opt.id)}
                      className="flex items-start gap-2"
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 mt-0.5 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{opt.label}</span>
                        {opt.hint && (
                          <span className="text-[10px] text-muted-foreground truncate">
                            {opt.hint}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
