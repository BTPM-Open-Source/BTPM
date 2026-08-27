import { useState, useRef, useEffect } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FindState, FindResult } from "@/lib/projectFindInProject";
import { cn } from "@/lib/utils";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  matchesOnly: boolean;
  onMatchesOnlyChange: (v: boolean) => void;
  state: FindState;
  onPick?: (result: FindResult) => void;
  className?: string;
  inputId?: string;
}

export function FindInProjectToolbar({
  query,
  onQueryChange,
  matchesOnly,
  onMatchesOnlyChange,
  state,
  onPick,
  className,
  inputId,
}: Props) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.active && state.results.length > 0) setOpen(true);
    else setOpen(false);
  }, [state.active, state.results.length, query]);

  const count = state.matchedPhaseIds.size + state.matchedTaskIds.size;
  const countLabel = !state.active
    ? null
    : count === 0
    ? "No matches"
    : `${count} match${count === 1 ? "" : "es"}`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5",
        className
      )}
      role="search"
    >
      <Popover open={open && state.results.length > 0} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              id={inputId}
              ref={inputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Find phase or task…"
              className="h-8 w-[240px] pl-7 pr-7 text-xs"
              aria-label="Find phase or task"
              onFocus={() => {
                if (state.active && state.results.length > 0) setOpen(true);
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  onQueryChange("");
                  inputRef.current?.focus();
                }}
                className="absolute right-1.5 p-0.5 rounded hover:bg-accent"
                aria-label="Clear find"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[320px] p-1 max-h-[300px] overflow-y-auto"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {state.results.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              No matches
            </div>
          ) : (
            <ul className="space-y-0.5">
              {state.results.map((r) => (
                <li key={`${r.type}-${r.id}`}>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent focus:bg-accent focus:outline-none"
                    onClick={() => {
                      onPick?.(r);
                      setOpen(false);
                    }}
                  >
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1.5">
                      {r.type}
                    </span>
                    {r.type === "phase" ? (
                      <span className="font-medium">{r.name}</span>
                    ) : (
                      <span>
                        <span className="text-muted-foreground">
                          {r.phaseName} ›{" "}
                        </span>
                        <span className="font-medium">{r.name}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {countLabel && (
        <span
          className={cn(
            "text-xs",
            count === 0 ? "text-muted-foreground" : "text-foreground"
          )}
          aria-live="polite"
        >
          {countLabel}
        </span>
      )}

      <div className="flex items-center gap-1.5 ml-1">
        <Switch
          id="find-matches-only"
          checked={matchesOnly}
          onCheckedChange={onMatchesOnlyChange}
          disabled={!state.active}
        />
        <Label
          htmlFor="find-matches-only"
          className="text-xs text-muted-foreground cursor-pointer"
        >
          Show matches only
        </Label>
      </div>

      {state.active && state.results.length > 0 && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-1.5 text-xs text-muted-foreground"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle results"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
