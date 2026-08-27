import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Lock, Plus, Sparkles } from "lucide-react";
import {
  useAdoptionTemplatePreview,
  useWorkspaceAdoptionTemplates,
  useAddAdoptionTemplateTasksToExistingPlan,
  type AdoptionTemplateListItem,
} from "@/hooks/useProjectAdoption";

const normalize = (s: string | null | undefined) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

interface Props {
  projectId: string;
  workspaceId: string;
  canEdit: boolean;
  existingAdoptionTasks: Array<{
    id: string;
    name: string;
    adoption_initiative_id: string | null;
  }>;
  initiativeReadinessById: Record<string, string | null>;
}

export function AddTasksFromTemplatePanel({
  projectId,
  workspaceId,
  canEdit,
  existingAdoptionTasks,
  initiativeReadinessById,
}: Props) {
  const templatesQuery = useWorkspaceAdoptionTemplates(workspaceId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const preview = useAdoptionTemplatePreview(workspaceId, selectedTemplateId);
  const addTasks = useAddAdoptionTemplateTasksToExistingPlan(projectId);

  const templates: AdoptionTemplateListItem[] = templatesQuery.data ?? [];
  const isSystem = selectedTemplateId === null;

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Normalized existing titles (global + per readiness_area)
  const existingTitlesGlobal = useMemo(
    () => new Set(existingAdoptionTasks.map((t) => normalize(t.name))),
    [existingAdoptionTasks],
  );
  const existingTitlesByReadiness = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const t of existingAdoptionTasks) {
      const area = t.adoption_initiative_id
        ? initiativeReadinessById[t.adoption_initiative_id] ?? ""
        : "";
      if (!m[area]) m[area] = new Set();
      m[area].add(normalize(t.name));
    }
    return m;
  }, [existingAdoptionTasks, initiativeReadinessById]);

  type Row = {
    key: string;
    title: string;
    description: string | null;
    duplicate: boolean;
    reason: string | null;
  };
  type Group = { key: string; name: string; readiness_area: string; tasks: Row[] };

  const groups: Group[] = useMemo(() => {
    if (!preview.data) return [];
    return (preview.data.initiatives ?? []).map((init) => {
      const tasks: Row[] = (init.tasks ?? []).map((t) => {
        const norm = normalize(t.title);
        const inSameInit = existingTitlesByReadiness[init.readiness_area]?.has(norm);
        const inPlan = existingTitlesGlobal.has(norm);
        const duplicate = !!inSameInit || !!inPlan;
        const reason = inSameInit
          ? "Same initiative & title"
          : inPlan
            ? "Same title in plan"
            : null;
        return { key: `${init.key}.${t.key}`, title: t.title, description: t.description, duplicate, reason };
      });
      return { key: init.key, name: init.name, readiness_area: init.readiness_area, tasks };
    });
  }, [preview.data, existingTitlesGlobal, existingTitlesByReadiness]);

  // Seed selection: select only non-duplicate tasks
  useEffect(() => {
    if (!preview.data) return;
    const s = new Set<string>();
    for (const g of groups) for (const t of g.tasks) if (!t.duplicate) s.add(t.key);
    setSelectedKeys(s);
    setExpanded(new Set(groups.map((g) => g.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId, preview.data]);

  const stats = useMemo(() => {
    let newSelected = 0;
    let dupes = 0;
    for (const g of groups) {
      for (const t of g.tasks) {
        if (t.duplicate) dupes++;
        else if (selectedKeys.has(t.key)) newSelected++;
      }
    }
    return { newSelected, dupes };
  }, [groups, selectedKeys]);

  const toggle = (k: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const toggleExpand = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const handleAdd = async () => {
    if (selectedKeys.size === 0) return;
    try {
      const res = await addTasks.mutateAsync({
        templateId: selectedTemplateId,
        templateKey: "btpm_standard_adoption",
        selectedTaskKeys: Array.from(selectedKeys),
      });
      toast.success(
        `Added ${res.created_task_count} task${res.created_task_count === 1 ? "" : "s"} to the Adoption Plan${
          res.skipped_duplicate_count > 0 ? ` · ${res.skipped_duplicate_count} duplicate skipped` : ""
        }${
          res.created_initiative_count > 0
            ? ` · ${res.created_initiative_count} new initiative${res.created_initiative_count === 1 ? "" : "s"}`
            : ""
        }`,
      );
      setSelectedKeys(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add the selected tasks.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add tasks from template</CardTitle>
        <CardDescription>
          This project already has an Adoption Plan. You can add selected template tasks into the existing
          Adoption Plan. This will not create a second Adoption Plan. Tasks already in this plan are marked
          as "Already exists" and deselected by default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Template</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedTemplateId ?? "__standard__"}
              onValueChange={(v) => setSelectedTemplateId(v === "__standard__" ? null : v)}
              disabled={templatesQuery.isLoading || addTasks.isPending}
            >
              <SelectTrigger className="w-full sm:w-[360px]">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__standard__">BTPM Standard Adoption Template</SelectItem>
                {templates
                  .filter((t) => t.template_id !== null)
                  .map((t) => (
                    <SelectItem key={t.template_id!} value={t.template_id!}>
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {isSystem ? (
              <Badge variant="outline" className="gap-1">
                <Lock className="h-3 w-3" /> Standard · read-only
              </Badge>
            ) : (
              <Badge variant="outline">Custom · workspace</Badge>
            )}
          </div>
        </div>

        {preview.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tasks available in this template.</p>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {stats.newSelected} new task{stats.newSelected === 1 ? "" : "s"} selected · {stats.dupes} already
              exist{stats.dupes === 1 ? "s" : ""}
            </div>
            {groups.map((g) => {
              const isOpen = expanded.has(g.key);
              const newCount = g.tasks.filter((t) => !t.duplicate).length;
              const dupCount = g.tasks.filter((t) => t.duplicate).length;
              return (
                <div key={g.key} className="rounded-md border border-border">
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 p-3 text-left"
                    onClick={() => toggleExpand(g.key)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm flex-1 truncate">{g.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {newCount} new
                    </Badge>
                    {dupCount > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {dupCount} already exist
                      </Badge>
                    )}
                  </button>
                  {isOpen && (
                    <div className="border-t border-border p-3 space-y-1.5">
                      {g.tasks.map((t) => {
                        const checked = selectedKeys.has(t.key) && !t.duplicate;
                        return (
                          <div key={t.key} className="flex items-start gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => !t.duplicate && toggle(t.key)}
                              disabled={t.duplicate || !canEdit || addTasks.isPending}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`font-medium ${t.duplicate ? "text-muted-foreground" : ""}`}>
                                  {t.title}
                                </span>
                                {t.duplicate && (
                                  <Badge variant="outline" className="text-[10px]">
                                    Already exists{t.reason ? ` · ${t.reason}` : ""}
                                  </Badge>
                                )}
                              </div>
                              {t.description && (
                                <div className="text-xs text-muted-foreground">{t.description}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canEdit ? (
          <Button
            onClick={handleAdd}
            disabled={addTasks.isPending || stats.newSelected === 0}
          >
            <Plus className="h-4 w-4 mr-1" />
            {addTasks.isPending ? "Adding…" : `Add selected tasks${stats.newSelected ? ` (${stats.newSelected})` : ""}`}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            You have read-only access. Ask a project manager to add tasks from a template.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
