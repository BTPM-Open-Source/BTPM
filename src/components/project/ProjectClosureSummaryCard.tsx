/**
 * Phase 6C — Step 6C.5 — Project Closure Summary card.
 *
 * Compact PM-authored narrative captured at any project stage. All persistence
 * flows through the SECURITY DEFINER RPCs in `useProjectClosureSummary`.
 * Editing is gated by project-edit authority (server-enforced independently).
 */
import { useEffect, useMemo, useState } from "react";
import { FileText, Pencil, PlusCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  useProjectClosureSummary,
  useUpsertProjectClosureSummary,
  PROJECT_CLOSURE_SUMMARY_MAX_LENGTH,
  type ProjectClosureSummary,
} from "@/hooks/useProjectClosureSummary";

interface Props {
  projectId: string;
  canEdit?: boolean;
  projectStatus?: string | null;
}

const FIELDS: {
  key: keyof Pick<
    ProjectClosureSummary,
    | "outcome_summary"
    | "benefits_summary"
    | "achievements_summary"
    | "open_items_summary"
    | "transition_notes"
  >;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "outcome_summary",
    label: "Project Outcome",
    placeholder: "Summarize the overall outcome of the project.",
  },
  {
    key: "benefits_summary",
    label: "Key Benefits Delivered",
    placeholder: "Summarize the business benefits delivered or expected.",
  },
  {
    key: "achievements_summary",
    label: "Major Achievements",
    placeholder: "Capture significant achievements, improvements, or milestones.",
  },
  {
    key: "open_items_summary",
    label: "Open Items / Follow-up",
    placeholder: "Capture unresolved items, handover points, or follow-up actions.",
  },
  {
    key: "transition_notes",
    label: "Transition Notes",
    placeholder: "Capture transition, ownership, support, or adoption notes.",
  },
];

function truncate(text: string, max = 280): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

function isPostClosureStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === "completed" || s === "closed" || s === "cancelled" || s === "canceled";
}

export function ProjectClosureSummaryCard({ projectId, canEdit = false, projectStatus }: Props) {
  const { data: summary, isLoading, isError } = useProjectClosureSummary(projectId);
  const upsert = useUpsertProjectClosureSummary(projectId);
  const [open, setOpen] = useState(false);

  const hasAny = useMemo(
    () =>
      !!summary &&
      FIELDS.some((f) => {
        const v = summary[f.key];
        return typeof v === "string" && v.trim().length > 0;
      }),
    [summary],
  );

  const postClosure = isPostClosureStatus(projectStatus);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Project Closure Summary
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Capture the concise project outcome narrative that will later be included in the
            Project Closure Report.
          </p>
        </div>
        {canEdit ? (
          <Button
            variant={hasAny ? "outline" : "default"}
            size="sm"
            onClick={() => setOpen(true)}
            disabled={isLoading}
          >
            {hasAny ? (
              <>
                <Pencil className="mr-1 h-4 w-4" /> Edit summary
              </>
            ) : (
              <>
                <PlusCircle className="mr-1 h-4 w-4" /> Add closure summary
              </>
            )}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit && postClosure ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            This project appears closed/completed. Closure summary updates are still allowed and
            will be logged.
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to load closure summary.</p>
        ) : !hasAny ? (
          <p className="text-sm text-muted-foreground">
            No closure summary has been captured yet. This narrative will be used later in the
            Project Closure Report.
          </p>
        ) : (
          <dl className="space-y-3">
            {FIELDS.map((f) => {
              const value = summary?.[f.key];
              if (!value || value.trim().length === 0) return null;
              return (
                <div key={f.key}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {f.label}
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                    {truncate(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </CardContent>

      {canEdit ? (
        <ClosureSummaryDialog
          open={open}
          onOpenChange={setOpen}
          initial={summary ?? null}
          submitting={upsert.isPending}
          onSubmit={async (input) => {
            await upsert.mutateAsync(input);
            setOpen(false);
          }}
          postClosure={postClosure}
        />
      ) : null}
    </Card>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ProjectClosureSummary | null;
  submitting: boolean;
  postClosure: boolean;
  onSubmit: (input: {
    outcome_summary: string | null;
    benefits_summary: string | null;
    achievements_summary: string | null;
    open_items_summary: string | null;
    transition_notes: string | null;
  }) => Promise<void>;
}

function ClosureSummaryDialog({
  open,
  onOpenChange,
  initial,
  submitting,
  postClosure,
  onSubmit,
}: DialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues({
        outcome_summary: initial?.outcome_summary ?? "",
        benefits_summary: initial?.benefits_summary ?? "",
        achievements_summary: initial?.achievements_summary ?? "",
        open_items_summary: initial?.open_items_summary ?? "",
        transition_notes: initial?.transition_notes ?? "",
      });
      setError(null);
    }
  }, [open, initial]);

  const anyFilled = FIELDS.some((f) => (values[f.key] ?? "").trim().length > 0);
  const overLimit = FIELDS.some(
    (f) => (values[f.key] ?? "").length > PROJECT_CLOSURE_SUMMARY_MAX_LENGTH,
  );

  const handleSave = async () => {
    setError(null);
    if (!anyFilled) {
      setError("Enter at least one closure summary field before saving.");
      return;
    }
    if (overLimit) {
      setError(`Each field must be ${PROJECT_CLOSURE_SUMMARY_MAX_LENGTH} characters or fewer.`);
      return;
    }
    try {
      await onSubmit({
        outcome_summary: values.outcome_summary?.trim() || null,
        benefits_summary: values.benefits_summary?.trim() || null,
        achievements_summary: values.achievements_summary?.trim() || null,
        open_items_summary: values.open_items_summary?.trim() || null,
        transition_notes: values.transition_notes?.trim() || null,
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to save closure summary.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project Closure Summary</DialogTitle>
          <DialogDescription>
            Keep each field concise (2–3 paragraphs). This narrative will be reused in the future
            Project Closure Report.
          </DialogDescription>
        </DialogHeader>

        {postClosure ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            This project appears closed/completed. Updates are still allowed and will be logged.
          </div>
        ) : null}

        <div className="space-y-4">
          {FIELDS.map((f) => {
            const v = values[f.key] ?? "";
            const remaining = PROJECT_CLOSURE_SUMMARY_MAX_LENGTH - v.length;
            return (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`closure-${f.key}`}>{f.label}</Label>
                <Textarea
                  id={`closure-${f.key}`}
                  placeholder={f.placeholder}
                  value={v}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  rows={4}
                  maxLength={PROJECT_CLOSURE_SUMMARY_MAX_LENGTH}
                />
                <p
                  className={cn(
                    "text-xs text-muted-foreground",
                    remaining < 0 && "text-destructive",
                  )}
                >
                  {remaining} characters remaining
                </p>
              </div>
            );
          })}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting || !anyFilled || overLimit}>
            {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save summary
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
