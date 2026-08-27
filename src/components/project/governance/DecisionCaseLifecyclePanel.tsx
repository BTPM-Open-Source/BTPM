/**
 * DC.12 — Decision Case Lifecycle Panel.
 *
 * Compact lifecycle checklist + forward-only stage actions.
 * Server is the authority — buttons call the protected RPC via
 * useTransitionGovernanceDecisionCaseStage. Prerequisite checks here are
 * UX-only; identical checks run in the RPC.
 */
import { useMemo } from "react";
import { toast } from "sonner";
import { Check, Circle, Dot, ArrowRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { DecisionStage } from "@/hooks/useProjectGovernance";
import {
  mapDecisionStageTransitionError,
  useTransitionGovernanceDecisionCaseStage,
  type DecisionStageTransitionTarget,
} from "@/hooks/useGovernanceLifecycle";
import { useGovernanceRecordBriefVersions } from "@/hooks/useGovernanceBriefVersions";
import { useGovernanceRecordStakeholderPackages } from "@/hooks/useGovernanceStakeholderPackages";

type StageKey =
  | "initiated"
  | "evidence_collection"
  | "brief_prepared"
  | "provided_to_stakeholders"
  | "pending_decision"
  | "decision_taken"
  | "closed";

const STAGE_SEQUENCE: { key: StageKey; label: string; hint?: string }[] = [
  { key: "initiated", label: "Initiated" },
  { key: "evidence_collection", label: "Evidence Collection" },
  { key: "brief_prepared", label: "Brief Prepared", hint: "Requires a current Decision Brief version." },
  { key: "provided_to_stakeholders", label: "Provided to Stakeholders", hint: "Set when a stakeholder package is marked provided." },
  { key: "pending_decision", label: "Pending Decision", hint: "Requires a provided stakeholder package." },
  { key: "decision_taken", label: "Decision Taken", hint: "Set when the formal outcome is saved." },
  { key: "closed", label: "Closed", hint: "Set when the case is closed." },
];

function stageOrder(stage: StageKey): number {
  return STAGE_SEQUENCE.findIndex((s) => s.key === stage) + 1;
}

export interface DecisionCaseLifecyclePanelProps {
  recordId: string;
  projectId: string;
  currentStage: DecisionStage | null | undefined;
  canEdit: boolean;
}

export function DecisionCaseLifecyclePanel({
  recordId,
  projectId,
  currentStage,
  canEdit,
}: DecisionCaseLifecyclePanelProps) {
  const stage: StageKey = (currentStage ?? "initiated") as StageKey;
  const currentOrder = stageOrder(stage);
  const terminal = stage === "decision_taken" || stage === "closed";

  const briefsQ = useGovernanceRecordBriefVersions(recordId);
  const pkgsQ = useGovernanceRecordStakeholderPackages(recordId);

  const hasCurrentBrief = useMemo(
    () => (briefsQ.data ?? []).some((b) => b.is_current),
    [briefsQ.data],
  );
  const hasProvidedPackage = useMemo(
    () =>
      (pkgsQ.data ?? []).some(
        (p) => p.is_current && p.package_status === "provided",
      ),
    [pkgsQ.data],
  );

  const transition = useTransitionGovernanceDecisionCaseStage(recordId, projectId);

  const handleTransition = async (
    target: DecisionStageTransitionTarget,
    label: string,
  ) => {
    try {
      await transition.mutateAsync(target);
      toast.success(`Stage moved to ${label}.`);
    } catch (e) {
      toast.error(mapDecisionStageTransitionError(e, "Could not change stage."));
    }
  };

  // Build action set (only those user can manually trigger via this panel).
  const actions: {
    target: DecisionStageTransitionTarget;
    label: string;
    buttonLabel: string;
    show: boolean;
    disabledReason?: string;
  }[] = [
    {
      target: "evidence_collection",
      label: "Evidence Collection",
      buttonLabel: "Start evidence collection",
      show: stageOrder("evidence_collection") > currentOrder && !terminal,
    },
    {
      target: "brief_prepared",
      label: "Brief Prepared",
      buttonLabel: "Mark brief prepared",
      show: stageOrder("brief_prepared") > currentOrder && !terminal,
      disabledReason: hasCurrentBrief
        ? undefined
        : "Save a current Decision Brief version first.",
    },
    {
      target: "pending_decision",
      label: "Pending Decision",
      buttonLabel: "Move to pending decision",
      show: stageOrder("pending_decision") > currentOrder && !terminal,
      disabledReason: hasProvidedPackage
        ? undefined
        : "Mark a stakeholder package as provided first.",
    },
  ];

  const submitting = transition.isPending;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Lifecycle</span>
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border-primary/30"
            >
              {STAGE_SEQUENCE.find((s) => s.key === stage)?.label ?? stage}
            </Badge>
          </div>

          {canEdit && !terminal && (
            <div className="flex items-center gap-2 flex-wrap">
              {actions
                .filter((a) => a.show)
                .map((a) => {
                  const disabled = submitting || !!a.disabledReason;
                  const btn = (
                    <Button
                      key={a.target}
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => handleTransition(a.target, a.label)}
                    >
                      <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      {a.buttonLabel}
                    </Button>
                  );
                  if (a.disabledReason) {
                    return (
                      <TooltipProvider key={a.target} delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{btn}</span>
                          </TooltipTrigger>
                          <TooltipContent>{a.disabledReason}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  }
                  return btn;
                })}
            </div>
          )}
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {STAGE_SEQUENCE.map((s, i) => {
            const order = i + 1;
            const completed = order < currentOrder;
            const current = order === currentOrder;
            return (
              <li
                key={s.key}
                className={cn(
                  "rounded-md border px-2 py-2 flex flex-col gap-1",
                  current && "border-primary/40 bg-primary/5",
                  completed && "border-muted bg-muted/30",
                  !current && !completed && "border-dashed",
                )}
              >
                <div className="flex items-center gap-1.5">
                  {completed ? (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  ) : current ? (
                    <Dot className="h-4 w-4 text-primary" />
                  ) : (
                    <Circle className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      "text-xs font-medium truncate",
                      current && "text-primary",
                      !current && !completed && "text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                </div>
                {s.hint && !completed && (
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    {s.hint}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Read-only view. Ask a project manager to advance the lifecycle.
          </p>
        )}
        {terminal && canEdit && (
          <p className="text-xs text-muted-foreground">
            {stage === "closed"
              ? "This decision case is closed."
              : "A decision has been taken. Use the Decision Taken & Closure tab to close the case."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
