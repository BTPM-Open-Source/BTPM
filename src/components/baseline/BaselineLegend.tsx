import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

/**
 * Compact legend explaining what each Gantt baseline visual element means.
 * Renders as a small "What am I looking at?" popover trigger to keep the
 * toolbar uncluttered while making the meaning discoverable.
 */
export function BaselineLegend({ isBaselined }: { isBaselined: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground gap-1">
          <Info className="h-3.5 w-3.5" /> Legend
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-xs space-y-2">
        <div>
          <div className="font-semibold text-foreground mb-1">How to read this Gantt</div>
          <p className="text-muted-foreground">
            Bars show the <span className="font-medium text-foreground">current plan</span>.
            {isBaselined ? " Dashed outlines show the approved baseline." : " No baseline has been approved yet."}
          </p>
        </div>

        <ul className="space-y-2">
          <li className="flex items-start gap-2">
            <span className="mt-1 block h-3 w-6 rounded-sm bg-primary shrink-0" />
            <span><span className="font-medium text-foreground">Solid bar</span> — current planned dates (editable).</span>
          </li>
          {isBaselined && (
            <li className="flex items-start gap-2">
              <span className="mt-1 block h-3 w-6 rounded-sm border border-dashed border-muted-foreground/60 bg-muted-foreground/5 shrink-0" />
              <span><span className="font-medium text-foreground">Dashed ghost bar</span> — approved baseline (frozen).</span>
            </li>
          )}
          {isBaselined && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-flex shrink-0 items-center px-1 rounded-sm border border-destructive/60 text-destructive text-[10px] font-mono leading-tight bg-background">+5d</span>
              <span>
                <span className="font-medium text-foreground">Variance badge</span> — days the current end differs from baseline end.
                <span className="text-destructive"> Red = late.</span> <span className="text-primary">Blue = ahead.</span>
              </span>
            </li>
          )}
          {isBaselined && (
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-flex shrink-0 items-center px-1 rounded-sm border border-muted-foreground/60 text-muted-foreground text-[9px] uppercase tracking-wide bg-background">new</span>
              <span><span className="font-medium text-foreground">"new"</span> — item added after baseline approval; has no baseline reference.</span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <span className="mt-1 block h-3 w-0.5 bg-destructive shrink-0" />
            <span><span className="font-medium text-foreground">Today line</span> — vertical dashed line at today's date.</span>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
