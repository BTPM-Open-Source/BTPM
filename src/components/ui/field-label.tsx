import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FieldLabelProps {
  /** Visible field label */
  children: React.ReactNode;
  /** Short hint shown in tooltip on hover/focus of the help icon */
  hint?: string;
  /** Optional id of the input this label describes */
  htmlFor?: string;
  /** Mark field as required (adds an asterisk) */
  required?: boolean;
  className?: string;
}

/**
 * Standard form field label with an optional info tooltip.
 *
 * UX rule: every user-populated field should have a visible label and,
 * where useful, a short hint accessible via the (?) icon on hover/focus.
 */
export function FieldLabel({ children, hint, htmlFor, required, className }: FieldLabelProps) {
  return (
    <div className={cn("flex items-center gap-1.5 mb-1", className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {children}
        {required && <span className="text-destructive ml-0.5" aria-hidden>*</span>}
      </Label>
      {hint && (
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={0}
              aria-label={typeof children === "string" ? `${children} — more info` : "More info"}
              className="inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-full"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-xs text-xs leading-relaxed">
            {hint}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
