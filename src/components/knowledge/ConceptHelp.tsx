import { Link } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * ConceptHelp — small info icon with a short tooltip describing a BTPM
 * concept, with an optional "Learn more" deep-link to a Knowledge article.
 *
 * Lightweight by design: shortText is supplied locally (no per-tooltip RPC
 * fetches across operational pages). For full guidance, users follow the
 * articleSlug deep-link into the Knowledge Center.
 */
export interface ConceptHelpProps {
  term: string;
  shortText: string;
  articleSlug?: string;
  className?: string;
  /** Visual size of the trigger icon. */
  size?: "sm" | "md";
}

export function ConceptHelp({
  term,
  shortText,
  articleSlug,
  className,
  size = "sm",
}: ConceptHelpProps) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Help: ${term}`}
          className={cn(
            "inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors",
            className,
          )}
        >
          <HelpCircle className={iconSize} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs space-y-1.5">
        <p className="text-xs font-medium text-foreground">{term}</p>
        <p className="text-xs text-muted-foreground leading-snug">{shortText}</p>
        {articleSlug && (
          <Link
            to={`/knowledge/${articleSlug}`}
            className="inline-block text-xs text-primary hover:underline"
          >
            Learn more →
          </Link>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
