import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldLabel } from "@/components/ui/field-label";
import { Constants } from "@/integrations/supabase/types";
import { useUpdateBlocker, useCreateBlockerWithLinks } from "@/hooks/useProjectRisksBlockers";
import { useEntityLinks } from "@/hooks/useEntityLinks";
import { LinkEditor, type DraftPerson, type DraftObject } from "@/components/links/LinkEditor";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  blocker?: {
    id: string;
    title: string;
    description?: string | null;
    severity: string;
    status: string;
    updated_at: string;
  } | null;
  /** When omitted, defaults to project target. Allows reuse for task/phase blockers. */
  targetType?: string;
  targetId?: string;
  projectId: string;
  organizationId: string;
  workspaceId: string;
}

export function BlockerFormDialog({
  open,
  onOpenChange,
  blocker,
  targetType,
  targetId,
  projectId,
  organizationId,
  workspaceId,
}: Props) {
  const createBlocker = useCreateBlockerWithLinks();
  const updateBlocker = useUpdateBlocker();
  const isEdit = !!blocker;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [status, setStatus] = useState("open");
  const [people, setPeople] = useState<DraftPerson[]>([]);
  const [objects, setObjects] = useState<DraftObject[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load existing links when editing
  const { data: linksMap } = useEntityLinks("blocker", isEdit && blocker ? [blocker.id] : []);

  useEffect(() => {
    if (!open) return;
    setTitle(blocker?.title ?? "");
    setDescription(blocker?.description ?? "");
    setSeverity(blocker?.severity ?? "medium");
    setStatus(blocker?.status ?? "open");
    setSubmitError(null);
    if (!isEdit) {
      setPeople([]);
      setObjects([]);
    }
  }, [open, blocker, isEdit]);

  useEffect(() => {
    if (!isEdit || !blocker || !linksMap) return;
    const entry = linksMap[blocker.id];
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
  }, [isEdit, blocker, linksMap]);

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
      if (isEdit && blocker) {
        await updateBlocker.mutateAsync({
          id: blocker.id,
          expected_updated_at: blocker.updated_at,
          title: title.trim(),
          description: description.trim() || null,
          severity,
          status,
          user_links,
          object_links,
        });
      } else {
        await createBlocker.mutateAsync({
          title: title.trim(),
          description: description.trim() || null,
          severity,
          status,
          target_type: targetType ?? "project",
          target_id: targetId ?? projectId,
          user_links,
          object_links,
        });
      }
    } catch (e) {
      setSubmitError(
        e instanceof Error && e.message
          ? e.message
          : isEdit
            ? "Could not save the Blocker. Please try again."
            : "Could not create the Blocker. Please try again.",
      );
      return;
    }
    onOpenChange(false);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Blocker" : "New Blocker"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <FieldLabel hint="Short, descriptive name for the blocker (e.g. 'Awaiting access to staging environment')." required>
              Blocker title
            </FieldLabel>
            <Input placeholder="Blocker title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <FieldLabel hint="What is currently blocking progress, who is needed to unblock it, and any context that helps resolve it.">
              Description
            </FieldLabel>
            <Textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel hint="How urgently does this blocker need to be resolved? Higher severity should drive faster escalation.">
                Severity
              </FieldLabel>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  {Constants.public.Enums.pm_priority.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel hint="Lifecycle state of the blocker: open → in progress → resolved.">
                Status
              </FieldLabel>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  {Constants.public.Enums.blocker_status.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v === "in_progress" ? "In Progress" : v.charAt(0).toUpperCase() + v.slice(1)}
                    </SelectItem>
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

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSubmit} disabled={!title.trim() || createBlocker.isPending || updateBlocker.isPending}>
              {isEdit ? "Save" : "Create Blocker"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
