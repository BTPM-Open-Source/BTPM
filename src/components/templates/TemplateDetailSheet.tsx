import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useProjectTemplateDetail, useTemplateMutations } from "@/hooks/useProjectTemplates";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Archive, ArchiveRestore, X, Check } from "lucide-react";
import { format } from "date-fns";
import { LifecycleActions } from "@/components/lifecycle/LifecycleActions";
import { HARD_DELETE_CASCADE_COPY } from "@/lib/lifecycleVocabulary";
import { useCanHardDeleteBusinessObject } from "@/hooks/useCanHardDeleteBusinessObject";
import { usePlanningAuthority } from "@/hooks/usePlanningAuthority";

interface Props {
  workspaceId: string | undefined;
  templateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplateDetailSheet({ workspaceId, templateId, open, onOpenChange }: Props) {
  const { data: tpl, isLoading, error } = useProjectTemplateDetail(open ? templateId : null);
  const { renameTemplate, setArchived } = useTemplateMutations(workspaceId);
  const { toast } = useToast();
  const { canEdit } = usePlanningAuthority(workspaceId);
  const { data: canHardDelete = false } = useCanHardDeleteBusinessObject(workspaceId);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (tpl) {
      setName(tpl.name || "");
      setDescription(tpl.description || "");
      setEditing(false);
    }
  }, [tpl]);

  const handleSave = async () => {
    if (!templateId) return;
    if (!name.trim()) {
      toast({ title: "Name required", description: "Template name cannot be empty.", variant: "destructive" });
      return;
    }
    try {
      await renameTemplate.mutateAsync({ templateId, name: name.trim(), description: description.trim() || null });
      toast({ title: "Template updated" });
      setEditing(false);
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    }
  };

  // handleToggleArchive removed — Wave 5 Step 5.5 routes archive/unarchive
  // through <LifecycleActions /> and the canonical Step 5.3 RPCs.


  const counts = tpl?.summary_counts || {};
  const ps = tpl?.project_summary || null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Template details</SheetTitle>
          <SheetDescription>Reusable project blueprint stored in this workspace.</SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="space-y-3 mt-6">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {error && (
          <div className="mt-6 text-sm text-destructive">
            Failed to load template: {(error as Error).message}
          </div>
        )}

        {tpl && !isLoading && (
          <div className="space-y-6 mt-6">
            {/* Name + description */}
            <section className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                {editing ? (
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="text-base font-medium"
                    placeholder="Template name"
                  />
                ) : (
                  <h3 className="text-lg font-semibold text-foreground">{tpl.name || "Untitled template"}</h3>
                )}
                {!editing && (
                  <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="shrink-0">
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {editing ? (
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description"
                  rows={3}
                />
              ) : (
                tpl.description && <p className="text-sm text-muted-foreground">{tpl.description}</p>
              )}
              {editing && (
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setName(tpl.name || "");
                      setDescription(tpl.description || "");
                      setEditing(false);
                    }}
                  >
                    <X className="h-4 w-4 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={renameTemplate.isPending}>
                    <Check className="h-4 w-4 mr-1" /> Save
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {tpl.is_archived && <Badge variant="secondary">Archived</Badge>}
                {tpl.agile_enabled && <Badge variant="outline">Agile</Badge>}
                {tpl.schedule_mode && <Badge variant="outline">Schedule: {tpl.schedule_mode}</Badge>}
                <Badge variant="outline">v{tpl.blueprint_version}</Badge>
              </div>
            </section>

            <Separator />

            {/* Summary counts */}
            <section className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Blueprint contents</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <CountRow label="Phases" value={counts.phases} />
                <CountRow label="Tasks" value={counts.tasks} />
                <CountRow label="Dependencies" value={counts.dependencies} />
                <CountRow label="KPI definitions" value={counts.kpi_definitions} />
                <CountRow label="Workflow states" value={counts.workflow_states} />
                <CountRow label="Sprints" value={counts.sprints} />
                <CountRow label="Backlog items" value={counts.backlog_items} />
              </div>
            </section>

            {ps && (
              <>
                <Separator />
                <section className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground">Project snapshot</h4>
                  <div className="space-y-2 text-sm">
                    {ps.name && <Field label="Name" value={ps.name} />}
                    {ps.description && <Field label="Description" value={ps.description} />}
                    {ps.charter && <Field label="Charter" value={ps.charter} />}
                    {ps.goals && <Field label="Goals" value={ps.goals} />}
                    {ps.scope_in && <Field label="Scope in" value={ps.scope_in} />}
                    {ps.scope_out && <Field label="Scope out" value={ps.scope_out} />}
                    {ps.priority && <Field label="Priority" value={ps.priority} />}
                  </div>
                </section>
              </>
            )}

            <Separator />

            {/* Provenance */}
            <section className="space-y-1 text-xs text-muted-foreground">
              {tpl.anchor_source && <div>Anchor source: {tpl.anchor_source}</div>}
              {tpl.source_project_id && <div className="font-mono">Source project: {tpl.source_project_id.slice(0, 8)}…</div>}
              <div>Created: {format(new Date(tpl.created_at), "PPp")}</div>
              <div>Updated: {format(new Date(tpl.updated_at), "PPp")}</div>
            </section>

            {/* Lifecycle actions — canonical Step 5.3/5.5 path */}
            <div className="flex justify-end pt-2">
              <LifecycleActions
                target="project_template"
                id={tpl.template_id}
                name={tpl.name || "Untitled template"}
                isArchived={!!tpl.is_archived}
                canArchive={canEdit}
                canHardDelete={canHardDelete}
                cascadeDescription={HARD_DELETE_CASCADE_COPY.project_template}
                invalidate={[["workspace-templates", workspaceId], ["project-template-detail", tpl.template_id]]}
                onAfterHardDelete={() => onOpenChange(false)}
                size="default"
              />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CountRow({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value ?? 0}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-foreground whitespace-pre-wrap">{value}</div>
    </div>
  );
}
