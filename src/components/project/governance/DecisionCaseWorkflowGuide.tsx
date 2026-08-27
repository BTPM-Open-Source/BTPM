/**
 * AI.8.4 — Decision Case Workflow Guidance and Next Action Polish.
 *
 * Read-only, derived workflow guide. Computes step statuses from existing
 * source records (brief versions, stakeholder packages, decision outcome,
 * decision stage) and surfaces a single next-best-action that only
 * navigates to the relevant tab — never performs save/provide/close.
 *
 * No new persisted workflow status. No backend/schema/RPC changes.
 */
import { useMemo } from "react";
import { ArrowRight, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useGovernanceRecordBriefVersions } from "@/hooks/useGovernanceBriefVersions";
import { useGovernanceRecordStakeholderPackages } from "@/hooks/useGovernanceStakeholderPackages";
import { useGovernanceRecordDecisionOutcome } from "@/hooks/useGovernanceDecisionOutcome";
import type { DecisionStage } from "@/hooks/useProjectGovernance";

type StepState = "complete" | "in_progress" | "pending";

type Step = {
  key: string;
  title: string;
  state: StepState;
  label: string;
};

type Props = {
  recordId: string;
  decisionStage: DecisionStage | null | undefined;
  onNavigate: (tab: string) => void;
  hasDataPackageTab?: boolean;
};

export function DecisionCaseWorkflowGuide({
  recordId,
  decisionStage,
  onNavigate,
  hasDataPackageTab = true,
}: Props) {
  const briefsQ = useGovernanceRecordBriefVersions(recordId);
  const packagesQ = useGovernanceRecordStakeholderPackages(recordId);
  const outcomeQ = useGovernanceRecordDecisionOutcome(recordId);

  const currentBrief = useMemo(
    () => (briefsQ.data ?? []).find((b) => b.is_current) ?? null,
    [briefsQ.data],
  );
  const currentPackage = useMemo(
    () => (packagesQ.data ?? []).find((p) => p.is_current) ?? null,
    [packagesQ.data],
  );
  const outcome = outcomeQ.data ?? null;
  const isClosed = decisionStage === "closed";

  const steps: Step[] = useMemo(() => {
    const briefStep: Step = currentBrief
      ? {
          key: "brief",
          title: "Decision Brief",
          state: "complete",
          label: `Current brief v${currentBrief.version_number}`,
        }
      : {
          key: "brief",
          title: "Decision Brief",
          state: "pending",
          label: "No current brief",
        };

    let packageStep: Step;
    if (!currentPackage) {
      packageStep = {
        key: "package",
        title: "Stakeholder Package",
        state: "pending",
        label: "Not prepared",
      };
    } else if (currentPackage.package_status === "provided") {
      packageStep = {
        key: "package",
        title: "Stakeholder Package",
        state: "complete",
        label: `Provided v${currentPackage.version_number}`,
      };
    } else {
      const statusLabel =
        currentPackage.package_status === "ready" ? "Ready" : "Draft";
      packageStep = {
        key: "package",
        title: "Stakeholder Package",
        state: "in_progress",
        label: `${statusLabel} v${currentPackage.version_number}`,
      };
    }

    const outcomeStep: Step = outcome
      ? {
          key: "closure",
          title: "Decision Taken",
          state: "complete",
          label: "Outcome saved",
        }
      : {
          key: "closure",
          title: "Decision Taken",
          state: "pending",
          label: "No outcome",
        };

    const closureStep: Step = isClosed
      ? {
          key: "closure",
          title: "Closure",
          state: "complete",
          label: "Closed",
        }
      : {
          key: "closure",
          title: "Closure",
          state: "pending",
          label: "Open",
        };

    return [briefStep, packageStep, outcomeStep, closureStep];
  }, [currentBrief, currentPackage, outcome, isClosed]);

  const nextAction = useMemo(() => {
    if (!currentBrief) {
      return { label: "Prepare Decision Brief", tab: "brief" };
    }
    if (!currentPackage) {
      return { label: "Prepare Stakeholder Package", tab: "package" };
    }
    if (currentPackage.package_status !== "provided") {
      return { label: "Review Stakeholder Package", tab: "package" };
    }
    if (!outcome) {
      return { label: "Record Decision", tab: "closure" };
    }
    if (!isClosed) {
      return { label: "Close Decision Case", tab: "closure" };
    }
    return {
      label: "View Case Package",
      tab: hasDataPackageTab ? "data-package" : "closure",
    };
  }, [currentBrief, currentPackage, outcome, isClosed, hasDataPackageTab]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (outcome && currentPackage && currentPackage.package_status !== "provided") {
      out.push(
        "Decision outcome exists, but the Stakeholder Package was not marked as provided. This is allowed, but the normal flow is to provide the package first.",
      );
    }
    if (outcome && !currentPackage) {
      out.push(
        "Decision outcome exists, but no current Stakeholder Package is on file. Review source consistency if this was not intentional.",
      );
    }
    if (currentPackage && !currentBrief) {
      out.push(
        "Stakeholder Package exists without a current Decision Brief. Review source consistency if this was not intentional.",
      );
    }
    if (isClosed && !outcome) {
      out.push(
        "Case appears closed without a saved decision outcome. Review closure consistency.",
      );
    }
    return out;
  }, [currentBrief, currentPackage, outcome, isClosed]);

  const loading =
    briefsQ.isLoading || packagesQ.isLoading || outcomeQ.isLoading;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Decision Case workflow</h2>
            <p className="text-xs text-muted-foreground">
              Follow the decision from brief to stakeholder package, outcome, and closure.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => onNavigate(nextAction.tab)}
            disabled={loading}
          >
            {nextAction.label}
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {steps.map((step) => (
            <StepBadge key={`${step.key}-${step.title}`} step={step} />
          ))}
        </div>

        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map((w, i) => (
              <Alert key={i} variant="default" className="py-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">{w}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepBadge({ step }: { step: Step }) {
  const icon =
    step.state === "complete" ? (
      <CheckCircle2 className="h-4 w-4 text-primary" />
    ) : step.state === "in_progress" ? (
      <Circle className="h-4 w-4 text-amber-500 fill-amber-500/20" />
    ) : (
      <Circle className="h-4 w-4 text-muted-foreground" />
    );

  const badgeVariant: "default" | "secondary" | "outline" =
    step.state === "complete"
      ? "default"
      : step.state === "in_progress"
        ? "secondary"
        : "outline";

  return (
    <div className="flex items-center gap-2 rounded-md border p-2">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{step.title}</div>
        <Badge variant={badgeVariant} className="mt-0.5 text-[10px] font-normal">
          {step.label}
        </Badge>
      </div>
    </div>
  );
}
