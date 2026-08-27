import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceTemplates } from "@/hooks/useProjectTemplates";
import { useWorkspacePrograms } from "@/hooks/usePrograms";
import { parseWideningError, type WideningPayload } from "@/lib/cloneWideningService";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";
import { ParentExtensionConfirmDialog } from "@/components/planning/ParentExtensionConfirmDialog";
import {
  useWorkspacePortfolioPicker,
  useAssignProjectPortfolio,
} from "@/hooks/useProjectPortfolio";
import { ProjectPortfolioSelect } from "@/components/project/ProjectPortfolioSelect";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  PROJECT_DELIVERY_MODEL_VALUES,
  DELIVERY_MODEL_UNCLASSIFIED_SENTINEL,
  deliveryModelFromSelectValue,
  projectDeliveryModelLabel,
} from "@/lib/projectDeliveryModel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  organizationId: string;
}

const nameSchema = z
  .string()
  .trim()
  .nonempty({ message: "Project name is required" })
  .max(200, { message: "Name must be 200 characters or less" });

export function NewProjectDialog({ open, onOpenChange, workspaceId, organizationId }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [mode, setMode] = useState<"blank" | "template">("blank");
  const [name, setName] = useState("");
  const [programId, setProgramId] = useState("none");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>("");
  const [deliveryModel, setDeliveryModel] = useState<string>(DELIVERY_MODEL_UNCLASSIFIED_SENTINEL);
  const [portfolioItemId, setPortfolioItemId] = useState<string>("none");
  const [error, setError] = useState<string | null>(null);
  const [widening, setWidening] = useState<WideningPayload | null>(null);

  const { data: portfolioItems = [], isLoading: loadingPortfolios } =
    useWorkspacePortfolioPicker(workspaceId, open);
  const assignPortfolio = useAssignProjectPortfolio({
    workspaceId,
    organizationId,
  });

  const { data: programs = [] } = useWorkspacePrograms(workspaceId);
  const activePrograms = programs.filter((p) => !p.is_archived);
  const { data: templates, isLoading: loadingTemplates, error: tplError } = useWorkspaceTemplates(workspaceId, false);
  const activeTemplates = useMemo(() => (templates || []).filter((t) => !t.is_archived), [templates]);
  const selectedTemplate = useMemo(
    () => activeTemplates.find((t) => t.template_id === templateId) || null,
    [activeTemplates, templateId]
  );

  useEffect(() => {
    if (open) {
      setMode("blank");
      setName("");
      setProgramId("none");
      setTemplateId(null);
      setStartDate("");
      setDeliveryModel(DELIVERY_MODEL_UNCLASSIFIED_SENTINEL);
      setPortfolioItemId("none");
      setError(null);
      setWidening(null);
    }
  }, [open]);

  const createBlank = useMutation({
    mutationFn: async () => {
      const dm = deliveryModelFromSelectValue(deliveryModel);
      const { data, error } = await supabase.rpc("apply_project_create_blank", {
        _name: name.trim(),
        _workspace_id: workspaceId,
        _program_id: programId !== "none" ? programId : undefined,
        _delivery_model: dm ?? undefined,
      } as any);
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status === "applied") {
        const newId =
          (typeof result.data.id === "string" && result.data.id) ||
          (typeof result.data.project_id === "string" && result.data.project_id) ||
          result.target_id;
        if (!newId) throw new Error("Project created but id was not returned");
        return newId;
      }
      if (result.status === "not_authorized") {
        throw new Error("You do not have permission to create projects in this workspace");
      }
      if (result.status === "invalid") {
        const reason =
          typeof result.data.reason === "string" ? result.data.reason : "Invalid input";
        throw new Error(reason);
      }
      throw new Error(`Failed to create project (${result.status})`);
    },
  });

  const createFromTemplate = useMutation({
    mutationFn: async (confirmWidening: boolean) => {
      if (!templateId) throw new Error("Select a template");
      const dm = deliveryModelFromSelectValue(deliveryModel);
      const { data, error } = await supabase.rpc("instantiate_project_from_template", {
        _template_id: templateId,
        _new_project_name: name.trim(),
        _program_id: programId !== "none" ? programId : undefined,
        _project_start_date: startDate || undefined,
        _confirm_widening: confirmWidening,
        _delivery_model: dm ?? undefined,
      } as any);
      if (error) throw error;
      const payload = data as any;
      const newId =
        payload?.project_id ||
        payload?.id ||
        payload?.new_project_id ||
        (typeof payload === "string" ? payload : null);
      if (!newId) throw new Error("Project created but id was not returned");
      return newId as string;
    },
  });

  const submitting = createBlank.isPending || createFromTemplate.isPending;

  const finishSuccess = async (newId: string) => {
    let portfolioFailed = false;
    if (portfolioItemId !== "none") {
      try {
        await assignPortfolio.mutateAsync({
          projectId: newId,
          portfolioItemId: portfolioItemId,
        });
      } catch {
        portfolioFailed = true;
      }
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["workspace-projects", workspaceId] });
    if (portfolioFailed) {
      toast({
        title: "Project created, Portfolio not assigned",
        description:
          "Project was created, but Portfolio was not assigned. You can assign it later from Project settings.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Project created",
        description: mode === "template" ? "Created from template." : undefined,
      });
    }
    onOpenChange(false);
    navigate(`/workspace/${workspaceId}/project/${newId}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setWidening(null);

    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message || "Invalid name");
      return;
    }

    if (mode === "template" && !templateId) {
      setError("Please select a template");
      return;
    }

    try {
      if (mode === "blank") {
        finishSuccess(await createBlank.mutateAsync());
      } else {
        finishSuccess(await createFromTemplate.mutateAsync(false));
      }
    } catch (err: any) {
      const w = parseWideningError(err);
      if (w) {
        setWidening(w);
      } else {
        setError(err?.message || "Failed to create project");
      }
    }
  };

  const confirmWidening = async () => {
    setError(null);
    try {
      finishSuccess(await createFromTemplate.mutateAsync(true));
    } catch (err: any) {
      setWidening(null);
      setError(err?.message || "Failed to create project");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Start a blank project or instantiate one from a saved template.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
            <Tabs value={mode} onValueChange={(v) => { setMode(v as "blank" | "template"); setError(null); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="blank">Blank</TabsTrigger>
                <TabsTrigger value="template">From template</TabsTrigger>
              </TabsList>

              <ScrollArea className="max-h-[55vh] mt-4 pr-3">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="np-name">Project name</Label>
                    <Input
                      id="np-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={200}
                      autoFocus
                      required
                    />
                  </div>

                  {activePrograms.length > 0 && (
                    <div className="space-y-1.5">
                      <Label>Program (optional)</Label>
                      <Select value={programId} onValueChange={setProgramId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No program</SelectItem>
                          {activePrograms.map((pg) => (
                            <SelectItem key={pg.id} value={pg.id}>{pg.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <ProjectPortfolioSelect
                    value={portfolioItemId}
                    onChange={setPortfolioItemId}
                    items={portfolioItems}
                    loading={loadingPortfolios}
                    disabled={submitting}
                  />



                  <div className="space-y-1.5">
                    <Label>Delivery model</Label>
                    <Select value={deliveryModel} onValueChange={setDeliveryModel}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DELIVERY_MODEL_UNCLASSIFIED_SENTINEL}>
                          {projectDeliveryModelLabel(null)}
                        </SelectItem>
                        {PROJECT_DELIVERY_MODEL_VALUES.map((v) => (
                          <SelectItem key={v} value={v}>{projectDeliveryModelLabel(v)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Classifies how this project is delivered. Optional — leave as Unclassified if not yet decided.
                    </p>
                  </div>

                  <TabsContent value="blank" className="m-0 mt-2">
                    <p className="text-xs text-muted-foreground">
                      A blank project is created with no phases or tasks.
                    </p>
                  </TabsContent>

                  <TabsContent value="template" className="m-0 mt-2 space-y-4">
                    <div className="space-y-1.5">
                      <Label>Template</Label>
                      {loadingTemplates && <Skeleton className="h-20 w-full" />}
                      {tplError && (
                        <p className="text-sm text-destructive">
                          Failed to load templates: {(tplError as Error).message}
                        </p>
                      )}
                      {!loadingTemplates && !tplError && activeTemplates.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No active templates in this workspace. Save a project as a template first.
                        </p>
                      )}
                      {activeTemplates.length > 0 && (
                        <div className="space-y-1.5 max-h-56 overflow-y-auto rounded-md border border-border p-1">
                          {activeTemplates.map((t) => {
                            const sel = templateId === t.template_id;
                            return (
                              <button
                                type="button"
                                key={t.template_id}
                                onClick={() => setTemplateId(t.template_id)}
                                className={cn(
                                  "w-full text-left rounded-md px-3 py-2 text-sm transition-colors",
                                  sel
                                    ? "bg-primary/10 border border-primary/40"
                                    : "hover:bg-accent border border-transparent"
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-foreground truncate">{t.name || "Untitled"}</span>
                                  <div className="flex gap-1 shrink-0">
                                    {t.agile_enabled && <Badge variant="outline" className="text-[10px]">Agile</Badge>}
                                    {t.schedule_mode && (
                                      <Badge variant="outline" className="text-[10px]">{t.schedule_mode}</Badge>
                                    )}
                                  </div>
                                </div>
                                {t.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-1">{t.description}</p>
                                )}
                                <div className="text-[11px] text-muted-foreground mt-1">
                                  {t.summary_counts?.phases ?? 0} phases · {t.summary_counts?.tasks ?? 0} tasks · {t.summary_counts?.dependencies ?? 0} deps
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {selectedTemplate && (
                      <div className="rounded-md bg-muted/40 p-3 space-y-1.5 text-xs">
                        <div className="font-medium text-foreground text-sm">{selectedTemplate.name}</div>
                        {selectedTemplate.description && (
                          <p className="text-muted-foreground">{selectedTemplate.description}</p>
                        )}
                        <div className="text-muted-foreground">
                          {selectedTemplate.summary_counts?.phases ?? 0} phases · {selectedTemplate.summary_counts?.tasks ?? 0} tasks ·{" "}
                          {selectedTemplate.summary_counts?.dependencies ?? 0} deps ·{" "}
                          {selectedTemplate.summary_counts?.kpi_definitions ?? 0} KPIs ·{" "}
                          {selectedTemplate.summary_counts?.workflow_states ?? 0} states ·{" "}
                          {selectedTemplate.summary_counts?.sprints ?? 0} sprints ·{" "}
                          {selectedTemplate.summary_counts?.backlog_items ?? 0} backlog
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="np-start">Project start date (optional)</Label>
                      <Input
                        id="np-start"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Treated as the source project&apos;s start date. Phases or tasks that began before the source start will land before this date too — you&apos;ll be asked to confirm widening the project window in that case.
                      </p>
                    </div>
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>

            {error && (
              <p className="text-sm text-destructive mt-3" role="alert">{error}</p>
            )}

            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  !name.trim() ||
                  (mode === "template" && !templateId)
                }
              >
                {submitting ? "Creating…" : mode === "template" ? "Create from template" : "Create project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ParentExtensionConfirmDialog
        open={!!widening}
        parentKind="project"
        parentName={name.trim() || "New project"}
        currentStart={widening?.nominal_start ?? null}
        currentEnd={widening?.nominal_end ?? null}
        proposedStart={widening?.effective_start ?? null}
        proposedEnd={widening?.effective_end ?? null}
        pending={createFromTemplate.isPending}
        onConfirm={confirmWidening}
        onCancel={() => setWidening(null)}
      />
    </>
  );
}
