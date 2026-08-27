import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * TAE.7A — compact read-only Requester/Executors context for a Planning row.
 *
 * Sourced entirely from the protected Task list payload
 * (`requested_by_stakeholder`, `executed_by_stakeholders`) returned by
 * `list_decrypted_project_tasks`. No new reads are performed here.
 */

export interface AccountabilityStakeholder {
  id: string;
  display_name: string;
  stakeholder_type: string | null;
  role_label: string | null;
  is_removed: boolean | null;
}

interface TaskAccountabilityInlineProps {
  requester?: AccountabilityStakeholder | null;
  executors?: AccountabilityStakeholder[] | null;
  /** Max executor chips visible before collapsing into a +N remainder. */
  visibleExecutors?: number;
}

function personLabel(s: AccountabilityStakeholder): string {
  const parts: string[] = [s.display_name || "Unknown"];
  if (s.stakeholder_type === "external") parts.push("(External)");
  if (s.is_removed) parts.push("(Former)");
  if (s.role_label) parts.push(`— ${s.role_label}`);
  return parts.join(" ");
}

function PersonChip({
  stakeholder,
  prefix,
}: {
  stakeholder: AccountabilityStakeholder;
  prefix?: string;
}) {
  const isExternal = stakeholder.stakeholder_type === "external";
  const isRemoved = stakeholder.is_removed === true;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground max-w-[140px]",
      )}
      title={personLabel(stakeholder)}
    >
      {prefix && <span className="text-[10px] uppercase tracking-wide">{prefix}</span>}
      <span
        className={cn(
          "truncate",
          isRemoved && "line-through",
        )}
      >
        {stakeholder.display_name || "Unknown"}
      </span>
      {isExternal && (
        <Badge
          variant="outline"
          className="text-[9px] px-1 py-0 h-3.5 font-normal"
        >
          Ext
        </Badge>
      )}
      {isRemoved && (
        <Badge
          variant="secondary"
          className="text-[9px] px-1 py-0 h-3.5 font-normal"
        >
          Former
        </Badge>
      )}
    </span>
  );
}

export function TaskAccountabilityInline({
  requester,
  executors,
  visibleExecutors = 2,
}: TaskAccountabilityInlineProps) {
  const execList = Array.isArray(executors) ? executors : [];
  const hasRequester = !!requester;
  const hasExecutors = execList.length > 0;

  if (!hasRequester && !hasExecutors) return null;

  const visible = execList.slice(0, visibleExecutors);
  const hidden = execList.slice(visibleExecutors);
  const hiddenCount = hidden.length;

  const executorsAriaLabel = hasExecutors
    ? `Executed by ${execList.map(personLabel).join(", ")}`
    : undefined;

  return (
    <div
      className="flex items-center gap-2 text-xs"
      data-testid="task-accountability-inline"
    >
      {hasRequester && (
        <PersonChip stakeholder={requester!} prefix="Req" />
      )}
      {hasExecutors && (
        <div
          className="flex items-center gap-1"
          aria-label={executorsAriaLabel}
        >
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Exec
          </span>
          {visible.map((s) => (
            <PersonChip key={s.id} stakeholder={s} />
          ))}
          {hiddenCount > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="text-[10px] px-1.5 h-4 rounded border border-border text-muted-foreground hover:bg-accent"
                  aria-label={`Show ${hiddenCount} more executor${hiddenCount === 1 ? "" : "s"}`}
                >
                  +{hiddenCount}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2 text-xs">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Additional executors
                </div>
                <ul className="space-y-1">
                  {hidden.map((s) => (
                    <li key={s.id}>
                      <PersonChip stakeholder={s} />
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}
