import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ProjectOverviewSectionProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Lightweight presentational section wrapper used by ProjectOverviewTab.
 * Optional collapsible mode supports progressive disclosure for lower-
 * priority groupings (e.g. Documents & reports, More charter details).
 */
export function ProjectOverviewSection({
  title,
  description,
  actions,
  collapsible = false,
  defaultOpen = true,
  children,
}: ProjectOverviewSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const Header = () => (
    <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
      <div className="flex items-center gap-2 min-w-0">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-left text-foreground hover:text-foreground/80"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <h2 className="text-lg font-semibold">{title}</h2>
          </button>
        ) : (
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        )}
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );

  return (
    <section>
      <Header />
      {(!collapsible || open) && <div className="space-y-4">{children}</div>}
    </section>
  );
}
