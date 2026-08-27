import { Link } from "react-router-dom";
import { BookOpen, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * KnowledgeLink — compact "Learn more" link that deep-links into the
 * Knowledge Center for a stable article slug. Pure presentation; does NOT
 * fetch the article. The Knowledge page resolves the slug client-side via
 * the existing list_decrypted_knowledge_articles RPC.
 */
export interface KnowledgeLinkProps {
  slug: string;
  label?: string;
  variant?: "link" | "button" | "icon";
  className?: string;
  /** When true, opens the article in a new tab. Default false (in-app nav). */
  newTab?: boolean;
}

export function KnowledgeLink({
  slug,
  label = "Learn more",
  variant = "link",
  className,
  newTab = false,
}: KnowledgeLinkProps) {
  const to = `/knowledge/${slug}`;
  const linkProps = newTab
    ? { target: "_blank", rel: "noopener noreferrer" as const }
    : {};

  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={to}
            {...linkProps}
            aria-label={label}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
              className,
            )}
          >
            <BookOpen className="h-3.5 w-3.5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    );
  }

  if (variant === "button") {
    return (
      <Button asChild size="sm" variant="outline" className={className}>
        <Link to={to} {...linkProps}>
          <BookOpen className="mr-1 h-3.5 w-3.5" />
          {label}
        </Link>
      </Button>
    );
  }

  return (
    <Link
      to={to}
      {...linkProps}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-primary hover:underline",
        className,
      )}
    >
      <BookOpen className="h-3 w-3" />
      {label}
      {newTab && <ExternalLink className="h-3 w-3" />}
    </Link>
  );
}
