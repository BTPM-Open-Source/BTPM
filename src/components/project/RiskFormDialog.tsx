import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldLabel } from "@/components/ui/field-label";
import { Constants } from "@/integrations/supabase/types";
import { useCreateRisk, useUpdateRisk } from "@/hooks/useProjectRisksBlockers";
import { useEntityLinks } from "@/hooks/useEntityLinks";
import { RISK_STATUS_VALUES, RISK_STATUS_LABELS } from "@/lib/riskLifecycle";
import { LinkEditor, type DraftPerson, type DraftObject } from "@/components/links/LinkEditor";

interface RiskInput {
  id: string;
  title: string;
  description?: string | null;
  mitigation_plan?: string | null;
  likelihood: string;
  impact: string;
  status: string;
  updated_at: string;
}


interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  risk?: RiskInput | null;
  projectId: string;
  organizationId: string;
  workspaceId: string;
}

export function RiskFormDialog({ open, onOpenChange, risk, projectId, organizationId, workspaceId }: Props) {
  const createRisk = useCreateRisk();
  const updateRisk = useUpdateRisk();
  const isEdit = !!risk;

  const normalizeStatus = (s: string | undefined): string => {
    if (!s) return "open";
    if (s === "identified") return "open";
    if (s === "mitigating") return "under_mitigation";
    if (s === "accepted") return "monitoring";
    return s;
  };

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mitigationPlan, setMitigationPlan] = useState("");
  const [likelihood, setLikelihood] = useState("medium");
  const [impact, setImpact] = useState("medium");
  const [status, setStatus] = useState("open");
  const [people, setPeople] = useState<DraftPerson[]>([]);
  const [objects, setObjects] = useState<DraftObject[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);


  const { data: linksMap } = useEntityLinks("risk", isEdit && risk ? [risk.id] : []);

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);

    setTitle(risk?.title ?? "");
    setDescription(risk?.description ?? "");
    setMitigationPlan(risk?.mitigation_plan ?? "");
    setLikelihood(risk?.likelihood ?? "medium");
    setImpact(risk?.impact ?? "medium");
    setStatus(normalizeStatus(risk?.status));
    if (!isEdit) {
      setPeople([]);
      setObjects([]);
    }
  }, [open, risk, isEdit]);

  useEffect(() => {
    if (!isEdit || !risk || !linksMap) return;
    const entry = linksMap[risk.id];
    if (!entry) return;
    setPeople(
      entry.people.map((p) => ({
        user_id: p.user_id,
        stakeholder_id: p.stakeholder_id,
        stakeholder_type: p.stakeholder_type,
        display_name: p.display_name,
      })),
    );
    setObjects(
      entry.objects.map((o) => ({
        referenced_type: o.referenced_type,
        referenced_id: o.referenced_id,
        workspace_id: o.workspace_id,
        project_id: o.project_id,
        phase_id: o.phase_id,
        display_label: o.display_label,
        context_label: o.context_label,
      })),
    );
  }, [isEdit, risk, linksMap]);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitError(null);
    const user_links = people.map((p) =>
      p.stakeholder_id
        ? { stakeholder_id: p.stakeholder_id }
        : { user_id: p.user_id ?? undefined },
    );
    const object_links = objects.map((o) => ({
      referenced_type: o.referenced_type,
      referenced_id: o.referenced_id,
    }));

    try {
      if (isEdit && risk) {
        await updateRisk.mutateAsync({
          id: risk.id,
          expected_updated_at: risk.updated_at,
          title: title.trim(),
          description: description.trim() || null,
          mitigation_plan: mitigationPlan.trim() || null,
          likelihood,
          impact,
          status,
          user_links,
          object_links,
        });
      } else {
        await createRisk.mutateAsync({
          title: title.trim(),
          description: description.trim() || null,
          mitigation_plan: mitigationPlan.trim() || null,
          likelihood,
          impact,
          status,
          target_type: "project",
          target_id: projectId,
          organization_id: organizationId,
          workspace_id: workspaceId,
          user_links,
          object_links,
        });
      }
    } catch (e) {
      setSubmitError(
        e instanceof Error && e.message
          ? e.message
          : isEdit
            ? "Could not save the Risk. Please try again."
            : "Could not create the Risk. Please try again.",
      );
      return;
    }
    onOpenChange(false);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Risk" : "New Project Risk"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <FieldLabel hint="Short, descriptive name for the risk (e.g. 'Vendor delay on API delivery')." required>
              Risk title
            </FieldLabel>
            <Input placeholder="Risk title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <FieldLabel hint="What might happen and why it matters. Provide context for whoever reviews this risk later.">
              Description
            </FieldLabel>
            <Textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <FieldLabel hint="Planned actions to reduce the likelihood or impact of this risk if it materialises.">
              Mitigation plan
            </FieldLabel>
            <Textarea placeholder="Mitigation plan" value={mitigationPlan} onChange={(e) => setMitigationPlan(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <FieldLabel hint="How likely is this risk to occur? Used together with Impact to assess overall risk severity.">
                Likelihood
              </FieldLabel>
              <Select value={likelihood} onValueChange={setLikelihood}>
                <SelectTrigger><SelectValue placeholder="Likelihood" /></SelectTrigger>
                <SelectContent>
                  {Constants.public.Enums.risk_likelihood.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel hint="If the risk occurs, how severe would the consequences be on schedule, scope, cost or quality?">
                Impact
              </FieldLabel>
              <Select value={impact} onValueChange={setImpact}>
                <SelectTrigger><SelectValue placeholder="Impact" /></SelectTrigger>
                <SelectContent>
                  {Constants.public.Enums.pm_priority.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel hint="Lifecycle state of the risk: Open → Under Mitigation → Monitoring, or Realized / Closed.">
                Status
              </FieldLabel>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  {RISK_STATUS_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>{RISK_STATUS_LABELS[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <LinkEditor
            projectId={projectId}
            workspaceId={workspaceId}
            people={people}
            objects={objects}
            onPeopleChange={setPeople}
            onObjectsChange={setObjects}
          />

          {submitError && (
            <p className="text-sm text-destructive" role="alert">{submitError}</p>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSubmit} disabled={!title.trim() || createRisk.isPending || updateRisk.isPending}>

              {isEdit ? "Save" : "Create Risk"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
