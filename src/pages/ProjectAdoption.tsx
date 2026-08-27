import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddTasksFromTemplatePanel } from "@/components/adoption/AddTasksFromTemplatePanel";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { AlertTriangle, Sparkles, ExternalLink, Users, BookOpen, Megaphone, LineChart, LifeBuoy, RefreshCcw, MessageSquare, Target, X, Link2, ChevronDown, ChevronRight, Plus, Trash2, Check, Pencil } from "lucide-react";

import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useProjectPhases, usePhaseTasks } from "@/hooks/useProjectPlanning";
import { useProjectAllRisks, useProjectAllBlockers } from "@/hooks/useProjectRisksBlockers";
import { useKpiDefinitions } from "@/hooks/useProjectKpis";
import {
  useProjectAdoptionSubstrate,
  useProjectAdoptionTemplatePreview,
  useGenerateProjectAdoptionPlan,
  useLinkTaskToAdoption,
  useUnlinkTaskFromAdoption,
  useLinkAdoptionObject,
  useUnlinkAdoptionObject,
  useWorkspaceAdoptionTemplates,
  useAdoptionTemplatePreview,
  useCreateAdoptionTemplate,
  useUpdateAdoptionTemplate,
  useArchiveAdoptionTemplate,
  useGenerateProjectAdoptionPlanFromSavedTemplate,
  type AdoptionInitiative,
  type AdoptionObjectType,
  type AdoptionCustomTaskInput,
  type AdoptionTemplatePayload,
} from "@/hooks/useProjectAdoption";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Lock, Save, Settings2 } from "lucide-react";

const GENERAL_INITIATIVE_VALUE = "__general__";


const READINESS_AREA_LABELS: Record<string, string> = {
  stakeholder_impact: "Stakeholder Impact",
  sponsor_alignment: "Sponsor Alignment",
  communication: "Communication",
  training_enablement: "Training & Enablement",
  feedback_collection: "Feedback Collection",
  adoption_tracking: "Adoption Tracking",
  hypercare: "Hypercare",
  reinforcement_lessons: "Reinforcement / Lessons Learned",
};

const READINESS_AREA_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  stakeholder_impact: Users,
  sponsor_alignment: Target,
  communication: Megaphone,
  training_enablement: BookOpen,
  feedback_collection: MessageSquare,
  adoption_tracking: LineChart,
  hypercare: LifeBuoy,
  reinforcement_lessons: RefreshCcw,
};

function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const label = value.replace(/_/g, " ");
  return <Badge variant="outline" className="capitalize">{label}</Badge>;
}

function PriorityBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const map: Record<string, string> = {
    critical: "bg-destructive/10 text-destructive border-destructive/30",
    high: "bg-orange-500/10 text-orange-600 border-orange-500/30",
    medium: "bg-muted text-foreground border-border",
    low: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={`capitalize ${map[value] ?? ""}`}>
      {value}
    </Badge>
  );
}

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

export default function ProjectAdoption() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { project } = (useOutletContext<{ project: any; workspace: any }>() ?? { project: null, workspace: null }) as any;
  const { canEdit } = useProjectPlanningAuthority(projectId);

  const substrate = useProjectAdoptionSubstrate(projectId);
  const hasPlan = !!substrate.data?.hasAdoptionPlan;
  const [subTab, setSubTab] = useState<"plan" | "templates">("templates");
  useEffect(() => {
    setSubTab(hasPlan ? "plan" : "templates");
  }, [hasPlan]);
  const projectPreview = useProjectAdoptionTemplatePreview(projectId, { enabled: !hasPlan });
  const generate = useGenerateProjectAdoptionPlan(projectId);
  const generateFromSaved = useGenerateProjectAdoptionPlanFromSavedTemplate(projectId);
  const [manageSheetOpen, setManageSheetOpen] = useState(false);

  // CM.7B — Template library
  const templatesQuery = useWorkspaceAdoptionTemplates(workspaceId);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const templatePreview = useAdoptionTemplatePreview(workspaceId, selectedTemplateId);
  const createTemplate = useCreateAdoptionTemplate(workspaceId);
  const updateTemplate = useUpdateAdoptionTemplate(workspaceId);
  const archiveTemplate = useArchiveAdoptionTemplate(workspaceId);

  // Keep `preview` alias for date-suggestion (project-based) reads.
  const preview = projectPreview;

  const phases = useProjectPhases(projectId);
  const tasks = usePhaseTasks(projectId);

  const [phaseName, setPhaseName] = useState<string>("");
  const [phaseStartDate, setPhaseStartDate] = useState<string>("");
  const [phaseEndDate, setPhaseEndDate] = useState<string>("");
  const [datesTouched, setDatesTouched] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });

  // Selection state for the template wizard
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<Set<string> | null>(null);
  const [expandedInits, setExpandedInits] = useState<Set<string>>(new Set());
  const [customTasksByInit, setCustomTasksByInit] = useState<
    Record<string, Array<{ id: string; title: string; description: string; selected: boolean; isDraft: boolean; draftTitle: string; draftDescription: string }>>
  >({});

  // CM.7B — working overrides for custom template editing (title/description edits, removals)
  const [taskOverrides, setTaskOverrides] = useState<Record<string, { title?: string; description?: string | null }>>({});
  const [removedTaskKeys, setRemovedTaskKeys] = useState<Set<string>>(new Set());
  const [editingTaskKey, setEditingTaskKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; description: string }>({ title: "", description: "" });

  // CM.7B — dialogs
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");

  const isSystemTemplate = selectedTemplateId === null;
  const selectedTemplateMeta = (templatesQuery.data ?? []).find((t) =>
    selectedTemplateId === null ? t.template_id === null : t.template_id === selectedTemplateId,
  );

  // Reset working overrides when template changes
  useEffect(() => {
    setTaskOverrides({});
    setRemovedTaskKeys(new Set());
    setEditingTaskKey(null);
    setSelectedTaskKeys(null);
    setCustomTasksByInit({});
  }, [selectedTemplateId]);


  // Seed selection from the selected template preview once it loads.
  useEffect(() => {
    if (!templatePreview.data) return;
    if (selectedTaskKeys === null) {
      const seeded = new Set<string>();
      for (const init of templatePreview.data.initiatives ?? []) {
        for (const t of init.tasks ?? []) {
          if (t.default_selected !== false && init.default_selected !== false) {
            seeded.add(`${init.key}.${t.key}`);
          }
        }
      }
      setSelectedTaskKeys(seeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templatePreview.data]);

  // Seed phase dates from the project-based preview (independent of template choice)
  useEffect(() => {
    if (!projectPreview.data) return;
    if (!datesTouched.start && !phaseStartDate && projectPreview.data.suggested_phase_start_date) {
      setPhaseStartDate(projectPreview.data.suggested_phase_start_date);
    }
    if (!datesTouched.end && !phaseEndDate && projectPreview.data.suggested_phase_end_date) {
      setPhaseEndDate(projectPreview.data.suggested_phase_end_date);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPreview.data]);


  const recommendedPhaseName = preview.data?.recommended_phase_name ?? "Adoption & Readiness";
  const effectivePhaseName = phaseName.trim().length > 0 ? phaseName : recommendedPhaseName;

  const existingPhaseNames = useMemo(
    () => new Set((phases.data ?? []).filter((p: any) => !p.is_archived).map((p: any) => (p.name || "").toLowerCase())),
    [phases.data],
  );
  const phaseNameConflict = existingPhaseNames.has(effectivePhaseName.toLowerCase());

  const adoptionTasks = useMemo(() => {
    const all = (tasks.data ?? []) as any[];
    return all.filter((t) => t.is_adoption_related === true || t.adoption_initiative_id != null);
  }, [tasks.data]);

  const phaseNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of (phases.data ?? []) as any[]) m[p.id] = p.name ?? "Phase";
    return m;
  }, [phases.data]);

  const membersList = useWorkspaceMembers(project?.workspace_id);
  const membersMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const x of membersList.data ?? []) m[x.id] = x.display_name;
    return m;
  }, [membersList.data]);

  const initiativeNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const i of substrate.data?.initiatives ?? []) m[i.id] = i.name ?? "Initiative";
    return m;
  }, [substrate.data]);

  // ---------- CM.5 — Adoption link state & data ----------
  const risks = useProjectAllRisks(projectId);
  const blockers = useProjectAllBlockers(projectId);
  const kpis = useKpiDefinitions(projectId);

  const linkTask = useLinkTaskToAdoption(projectId);
  const unlinkTask = useUnlinkTaskFromAdoption(projectId);
  const linkObject = useLinkAdoptionObject(projectId);
  const unlinkObject = useUnlinkAdoptionObject(projectId);

  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [selectedTaskInitiative, setSelectedTaskInitiative] = useState<string>(GENERAL_INITIATIVE_VALUE);
  const [selectedObjectType, setSelectedObjectType] = useState<AdoptionObjectType>("risk");
  const [selectedObjectId, setSelectedObjectId] = useState<string>("");
  const [selectedObjectInitiative, setSelectedObjectInitiative] = useState<string>(GENERAL_INITIATIVE_VALUE);

  const candidateTasks = useMemo(() => {
    const all = (tasks.data ?? []) as any[];
    return all.filter((t) => !t.is_archived);
  }, [tasks.data]);

  const linkedObjectsList = substrate.data?.linkedObjects ?? [];
  const linkedKey = (type: string, id: string) => `${type}:${id}`;
  const linkedSet = useMemo(() => {
    const s = new Set<string>();
    for (const l of linkedObjectsList) s.add(linkedKey(l.object_type, l.object_id));
    return s;
  }, [linkedObjectsList]);

  type CandidateObject = { id: string; label: string; alreadyLinked: boolean };
  const candidateObjects: CandidateObject[] = useMemo(() => {
    if (selectedObjectType === "risk") {
      return (risks.data ?? []).map((r) => ({
        id: r.id,
        label: `${r.title}${r.status ? ` · ${r.status}` : ""}${r.impact ? ` · impact ${r.impact}` : ""}${r.source_name ? ` · ${r.source_name}` : ""}`,
        alreadyLinked: linkedSet.has(linkedKey("risk", r.id)),
      }));
    }
    if (selectedObjectType === "blocker") {
      return (blockers.data ?? []).map((b) => ({
        id: b.id,
        label: `${b.title}${b.status ? ` · ${b.status}` : ""}${b.severity ? ` · ${b.severity}` : ""}${b.source_name ? ` · ${b.source_name}` : ""}`,
        alreadyLinked: linkedSet.has(linkedKey("blocker", b.id)),
      }));
    }
    return (kpis.data ?? []).map((k: any) => ({
      id: k.id,
      label: `${k.name ?? "KPI"}${k.current_value != null ? ` · ${k.current_value}${k.unit ? ` ${k.unit}` : ""}` : ""}`,
      alreadyLinked: linkedSet.has(linkedKey("kpi", k.id)),
    }));
  }, [selectedObjectType, risks.data, blockers.data, kpis.data, linkedSet]);

  const candidateObjectsLoading =
    (selectedObjectType === "risk" && risks.isLoading) ||
    (selectedObjectType === "blocker" && blockers.isLoading) ||
    (selectedObjectType === "kpi" && kpis.isLoading);

  type LinkedRow = {
    link: { id: string; object_type: string; object_id: string; adoption_initiative_id: string | null };
    label: string;
    details: string[];
  };
  const linkedGroups: Record<AdoptionObjectType, LinkedRow[]> = useMemo(() => {
    const groups: Record<AdoptionObjectType, LinkedRow[]> = { risk: [], blocker: [], kpi: [] };
    const riskMap = new Map((risks.data ?? []).map((r) => [r.id, r]));
    const blockerMap = new Map((blockers.data ?? []).map((b) => [b.id, b]));
    const kpiMap = new Map(((kpis.data ?? []) as any[]).map((k) => [k.id, k]));
    for (const l of linkedObjectsList) {
      const type = l.object_type as AdoptionObjectType;
      if (type !== "risk" && type !== "blocker" && type !== "kpi") continue;
      let label = `Linked ${type} · ${l.object_id.slice(0, 8)}…`;
      const details: string[] = [];
      if (type === "risk") {
        const r = riskMap.get(l.object_id);
        if (r) {
          label = r.title;
          if (r.status) details.push(r.status);
          if (r.impact) details.push(`impact ${r.impact}`);
          if (r.likelihood) details.push(`likelihood ${r.likelihood}`);
        }
      } else if (type === "blocker") {
        const b = blockerMap.get(l.object_id);
        if (b) {
          label = b.title;
          if (b.status) details.push(b.status);
          if (b.severity) details.push(b.severity);
        }
      } else {
        const k = kpiMap.get(l.object_id);
        if (k) {
          label = k.name ?? label;
          if (k.current_value != null) details.push(`${k.current_value}${k.unit ? ` ${k.unit}` : ""}`);
        }
      }
      groups[type].push({ link: l as any, label, details });
    }
    return groups;
  }, [linkedObjectsList, risks.data, blockers.data, kpis.data]);



  // ---------- Selection helpers ----------
  // Use the selected template's preview as the source of initiatives.
  // For custom templates, apply local overrides and removals.
  const rawTemplateInitiatives = templatePreview.data?.initiatives ?? [];
  const previewInitiatives = useMemo(() => {
    return rawTemplateInitiatives.map((init) => ({
      ...init,
      tasks: (init.tasks ?? [])
        .filter((t) => !removedTaskKeys.has(`${init.key}.${t.key}`))
        .map((t) => {
          const k = `${init.key}.${t.key}`;
          const ov = taskOverrides[k];
          return ov ? { ...t, title: ov.title ?? t.title, description: ov.description ?? t.description } : t;
        }),
    }));
  }, [rawTemplateInitiatives, taskOverrides, removedTaskKeys]);

  const taskKeyMap = useMemo(() => {
    const m = new Map<string, { initKey: string; title: string }>();
    for (const i of previewInitiatives) {
      for (const t of i.tasks ?? []) m.set(`${i.key}.${t.key}`, { initKey: i.key, title: t.title });
    }
    return m;
  }, [previewInitiatives]);

  const selectedKeys = selectedTaskKeys ?? new Set<string>();
  const customTasksList = useMemo(() => {
    const out: Array<{ initiativeKey: string; title: string; description: string; selected: boolean }> = [];
    for (const [k, arr] of Object.entries(customTasksByInit)) {
      for (const c of arr) {
        if (!c.isDraft && (c.title ?? "").trim().length > 0 && c.selected) {
          out.push({ initiativeKey: k, title: c.title.trim(), description: c.description, selected: c.selected });
        }
      }
    }
    return out;
  }, [customTasksByInit]);

  const draftCustomCount = useMemo(() => {
    let n = 0;
    for (const arr of Object.values(customTasksByInit)) {
      for (const c of arr) if (c.isDraft) n++;
    }
    return n;
  }, [customTasksByInit]);

  // CM.7B Correction — ALL non-draft custom tasks (selected or deselected) count
  // as unsaved template structure changes until the template is saved.
  const nonDraftCustomCount = useMemo(() => {
    let n = 0;
    for (const arr of Object.values(customTasksByInit)) {
      for (const c of arr) if (!c.isDraft && (c.title ?? "").trim().length > 0) n++;
    }
    return n;
  }, [customTasksByInit]);

  const selectedStdCount = selectedKeys.size;
  const customCount = customTasksList.length;
  const totalSelected = selectedStdCount + customCount;
  const selectedInitiativeCount = useMemo(() => {
    const inits = new Set<string>();
    for (const k of selectedKeys) {
      const entry = taskKeyMap.get(k);
      if (entry) inits.add(entry.initKey);
    }
    for (const c of customTasksList) inits.add(c.initiativeKey);
    return inits.size;
  }, [selectedKeys, customTasksList, taskKeyMap]);

  // CM.7B Correction — unsaved-changes guard for custom templates.
  const savedDefaultSelectedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const init of rawTemplateInitiatives) {
      for (const t of init.tasks ?? []) {
        if (t.default_selected !== false && init.default_selected !== false) {
          s.add(`${init.key}.${t.key}`);
        }
      }
    }
    return s;
  }, [rawTemplateInitiatives]);

  const selectionMatchesSaved = useMemo(() => {
    if (selectedTaskKeys === null) return true; // not yet seeded
    if (selectedTaskKeys.size !== savedDefaultSelectedKeys.size) return false;
    for (const k of selectedTaskKeys) if (!savedDefaultSelectedKeys.has(k)) return false;
    return true;
  }, [selectedTaskKeys, savedDefaultSelectedKeys]);

  const hasUnsavedTemplateChanges =
    !isSystemTemplate &&
    (Object.keys(taskOverrides).length > 0 ||
      removedTaskKeys.size > 0 ||
      nonDraftCustomCount > 0 ||
      draftCustomCount > 0 ||
      !selectionMatchesSaved);

  const phaseDateInvalid =
    !!phaseStartDate && !!phaseEndDate && phaseEndDate < phaseStartDate;



  const dateSourceHelper = (() => {
    switch (preview.data?.date_source) {
      case "project_dates":
        return "Dates suggested from the project planning window.";
      case "phase_dates":
        return "Dates suggested from existing project phase dates.";
      case "task_dates":
        return "Dates suggested from existing task dates.";
      default:
        return "No reliable project dates found. You can set the phase dates manually.";
    }
  })();

  const toggleExpanded = (key: string) => {
    setExpandedInits((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTaskKey = (key: string) => {
    setSelectedTaskKeys((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setInitiativeAll = (initKey: string, checked: boolean) => {
    setSelectedTaskKeys((prev) => {
      const next = new Set(prev ?? []);
      const init = previewInitiatives.find((i) => i.key === initKey);
      if (!init) return next;
      for (const t of init.tasks ?? []) {
        const k = `${initKey}.${t.key}`;
        if (checked) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const addCustomTask = (initKey: string) => {
    setCustomTasksByInit((prev) => {
      const arr = prev[initKey] ?? [];
      return {
        ...prev,
        [initKey]: [
          ...arr,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: "",
            description: "",
            selected: true,
            isDraft: true,
            draftTitle: "",
            draftDescription: "",
          },
        ],
      };
    });
    setExpandedInits((prev) => new Set(prev).add(initKey));
  };

  const updateCustomTask = (
    initKey: string,
    id: string,
    patch: Partial<{ title: string; description: string; selected: boolean; isDraft: boolean; draftTitle: string; draftDescription: string }>,
  ) => {
    setCustomTasksByInit((prev) => {
      const arr = prev[initKey] ?? [];
      return { ...prev, [initKey]: arr.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
    });
  };

  const saveCustomTask = (initKey: string, id: string) => {
    setCustomTasksByInit((prev) => {
      const arr = prev[initKey] ?? [];
      return {
        ...prev,
        [initKey]: arr.map((c) => {
          if (c.id !== id) return c;
          const title = (c.draftTitle ?? "").trim();
          if (title.length === 0) return c;
          return {
            ...c,
            title,
            description: (c.draftDescription ?? "").trim(),
            isDraft: false,
            selected: true,
          };
        }),
      };
    });
  };

  const editCustomTask = (initKey: string, id: string) => {
    setCustomTasksByInit((prev) => {
      const arr = prev[initKey] ?? [];
      return {
        ...prev,
        [initKey]: arr.map((c) =>
          c.id === id
            ? { ...c, isDraft: true, draftTitle: c.title, draftDescription: c.description }
            : c,
        ),
      };
    });
  };

  const removeCustomTask = (initKey: string, id: string) => {
    setCustomTasksByInit((prev) => {
      const arr = (prev[initKey] ?? []).filter((c) => c.id !== id);
      return { ...prev, [initKey]: arr };
    });
  };

  // CM.7B — build the current visible template payload for save/create.
  const buildCurrentPayload = (): AdoptionTemplatePayload => {
    const initiatives = (rawTemplateInitiatives ?? []).map((init, iSort) => {
      const baseTasks = (init.tasks ?? [])
        .filter((t) => !removedTaskKeys.has(`${init.key}.${t.key}`))
        .map((t, tSort) => {
          const k = `${init.key}.${t.key}`;
          const ov = taskOverrides[k];
          return {
            key: t.key,
            title: ov?.title ?? t.title,
            description: ov?.description ?? t.description,
            default_selected: selectedKeys.has(k),
            is_custom: t.is_custom ?? false,
            sort_order: tSort * 10,
          };
        });
      const customs = (customTasksByInit[init.key] ?? [])
        .filter((c) => !c.isDraft && c.title.trim().length > 0)
        .map((c, idx) => ({
          key: `custom_${c.id.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`,
          title: c.title.trim(),
          description: c.description?.trim() || null,
          default_selected: c.selected,
          is_custom: true,
          sort_order: (baseTasks.length + idx) * 10,
        }));
      return {
        key: init.key,
        name: init.name,
        readiness_area: init.readiness_area,
        summary: init.summary,
        default_selected: init.default_selected ?? true,
        sort_order: iSort * 10,
        tasks: [...baseTasks, ...customs],
      };
    });
    return {
      source_template_key: templatePreview.data?.is_system
        ? "btpm_standard_adoption"
        : templatePreview.data?.source_template_key ?? null,
      initiatives,
    };
  };

  const handleSaveTemplate = async () => {
    if (!selectedTemplateId || !selectedTemplateMeta) return;
    try {
      await updateTemplate.mutateAsync({
        templateId: selectedTemplateId,
        name: selectedTemplateMeta.name,
        description: selectedTemplateMeta.description ?? null,
        payload: buildCurrentPayload(),
      });
      // CM.7B Correction — clear all local edit state and reset selection so
      // the refreshed saved-template preview reseeds defaults. Without this
      // reset, stale `selectedTaskKeys` can keep `hasUnsavedTemplateChanges`
      // true after a successful save.
      setTaskOverrides({});
      setRemovedTaskKeys(new Set());
      setCustomTasksByInit({});
      setEditingTaskKey(null);
      setSelectedTaskKeys(null);
      toast.success("Template saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save template.");
    }
  };

  const handleCreateTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) return;
    try {
      const id = await createTemplate.mutateAsync({
        name,
        description: newTemplateDescription.trim() || null,
        payload: buildCurrentPayload(),
      });
      toast.success(`Template "${name}" saved`);
      setCreateDialogOpen(false);
      setNewTemplateName("");
      setNewTemplateDescription("");
      setSelectedTemplateId(id);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create template.");
    }
  };

  const handleArchiveTemplate = async () => {
    if (!selectedTemplateId) return;
    if (!confirm("Archive this template? It will no longer be available for new generations. Existing Adoption Plans are unaffected.")) return;
    try {
      await archiveTemplate.mutateAsync({ templateId: selectedTemplateId });
      toast.success("Template archived");
      setSelectedTemplateId(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not archive template.");
    }
  };

  const startEditTask = (initKey: string, taskKey: string, title: string, description: string | null) => {
    setEditingTaskKey(`${initKey}.${taskKey}`);
    setEditDraft({ title, description: description ?? "" });
  };
  const saveEditTask = (initKey: string, taskKey: string) => {
    const k = `${initKey}.${taskKey}`;
    if (!editDraft.title.trim()) return;
    setTaskOverrides((prev) => ({
      ...prev,
      [k]: { title: editDraft.title.trim(), description: editDraft.description.trim() || null },
    }));
    setEditingTaskKey(null);
  };
  const cancelEditTask = () => setEditingTaskKey(null);
  const removeTemplateTask = (initKey: string, taskKey: string) => {
    const k = `${initKey}.${taskKey}`;
    setRemovedTaskKeys((prev) => new Set(prev).add(k));
    setSelectedTaskKeys((prev) => {
      const next = new Set(prev ?? []);
      next.delete(k);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (hasUnsavedTemplateChanges) {
      toast.error("Save template changes before generating the Adoption Plan.");
      return;
    }
    try {
      const customTasks: AdoptionCustomTaskInput[] = customTasksList.map((c) => ({
        initiativeKey: c.initiativeKey,
        title: c.title,
        description: c.description?.trim() ? c.description.trim() : null,
      }));
      await generateFromSaved.mutateAsync({
        templateId: selectedTemplateId,
        templateKey: "btpm_standard_adoption",
        phaseName: effectivePhaseName,
        phaseStartDate: phaseStartDate || null,
        phaseEndDate: phaseEndDate || null,
        selectedTaskKeys: Array.from(selectedKeys),
        customTasks,
      });
      toast.success("Adoption Plan created");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate the Adoption Plan.");
    }
  };

  // CM.7B Correction — guarded template switching.
  const handleTemplateSelectChange = (v: string) => {
    if (hasUnsavedTemplateChanges) {
      const ok = confirm(
        "Save or discard template changes before switching templates. Discard unsaved changes and switch?",
      );
      if (!ok) return;
    }
    setSelectedTemplateId(v === "__standard__" ? null : v);
  };


  // -------- Loading --------
  if (substrate.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // -------- Error --------
  if (substrate.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Adoption Plan</CardTitle>
          <CardDescription>We couldn't load the Adoption Plan for this project.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => substrate.refetch()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  // ============================================================
  // Shared Templates editor.
  //
  // CM.7E separates two workflows:
  //   - mode="apply-generate": project-specific "Generate from template"
  //     wizard. Renders phase setup, selection checklist (no template-edit
  //     icons), and the Generate Adoption Plan action. No save/save-as/
  //     archive. Used only when the project has no Adoption Plan yet.
  //   - mode="manage": reusable workspace template management. Renders the
  //     template structure with edit/remove/add custom task controls and
  //     Save/Save-as/Archive. No phase setup, no Generate. Hosted inside
  //     the Manage templates sheet. Never shows project duplicate status.
  // ============================================================
  const renderTemplatesEditor = (mode: "apply-generate" | "manage") => {
    const isManage = mode === "manage";
    const isGenerate = mode === "apply-generate";
    const isPending = generate.isPending || generateFromSaved.isPending;
    const templates = templatesQuery.data ?? [];
    const generateDisabled =
      !canEdit ||
      isPending ||
      !effectivePhaseName.trim() ||
      totalSelected === 0 ||
      phaseDateInvalid ||
      draftCustomCount > 0 ||
      editingTaskKey !== null ||
      hasUnsavedTemplateChanges;

    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isManage ? "Manage templates" : "Generate from template"}
            </CardTitle>
            <CardDescription>
              {isManage
                ? "Create, edit, and archive reusable workspace templates. Template changes affect future use of the template. They do not change any generated Adoption Plan unless you later generate or add tasks from the template."
                : "Select which template tasks should be created for this project. This does not edit the reusable template. Generated work becomes normal Planning tasks."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Template selector */}
            <div className="space-y-2">
              <Label>Template</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={selectedTemplateId ?? "__standard__"}
                  onValueChange={handleTemplateSelectChange}
                  disabled={isPending || templatesQuery.isLoading}
                >
                  <SelectTrigger className="w-full sm:w-[360px]">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__standard__">BTPM Standard Adoption Template</SelectItem>
                    {templates.filter((t) => t.template_id !== null).map((t) => (
                      <SelectItem key={t.template_id!} value={t.template_id!}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isSystemTemplate ? (
                  <Badge variant="outline" className="gap-1">
                    <Lock className="h-3 w-3" /> Standard · read-only
                  </Badge>
                ) : (
                  <Badge variant="outline">Custom · workspace</Badge>
                )}
              </div>
              {isManage && (
                <p className="text-xs text-muted-foreground">
                  The BTPM Standard Template is read-only. To customize tasks, create a custom workspace
                  template first. Custom templates can be reused in other projects in this workspace.
                </p>
              )}
              {isManage && canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {isSystemTemplate ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNewTemplateName("BTPM Standard (custom copy)");
                        setNewTemplateDescription("");
                        setCreateDialogOpen(true);
                      }}
                      disabled={isPending}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Create custom template from this
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSaveTemplate}
                        disabled={isPending || updateTemplate.isPending}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        {updateTemplate.isPending ? "Saving…" : "Save template"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNewTemplateName(`${selectedTemplateMeta?.name ?? "Template"} (copy)`);
                          setNewTemplateDescription("");
                          setCreateDialogOpen(true);
                        }}
                        disabled={isPending}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Save as new template
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleArchiveTemplate}
                        disabled={isPending || archiveTemplate.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Archive template
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Phase setup — only when generating a new plan */}
            {isGenerate && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="adoption-phase-name">Phase name</Label>
                <Input
                  id="adoption-phase-name"
                  value={phaseName}
                  placeholder={recommendedPhaseName}
                  onChange={(e) => setPhaseName(e.target.value)}
                  disabled={!canEdit || generate.isPending}
                />
                {phaseNameConflict && (
                  <div className="flex items-start gap-2 text-xs text-orange-600">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                    <span>
                      A phase named "{effectivePhaseName}" already exists in this project. Choose a different
                      name to avoid a conflict.
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="adoption-phase-start">Phase start date</Label>
                <Input
                  id="adoption-phase-start"
                  type="date"
                  value={phaseStartDate}
                  onChange={(e) => {
                    setPhaseStartDate(e.target.value);
                    setDatesTouched((d) => ({ ...d, start: true }));
                  }}
                  disabled={!canEdit || generate.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adoption-phase-end">Phase end date</Label>
                <Input
                  id="adoption-phase-end"
                  type="date"
                  value={phaseEndDate}
                  onChange={(e) => {
                    setPhaseEndDate(e.target.value);
                    setDatesTouched((d) => ({ ...d, end: true }));
                  }}
                  disabled={!canEdit || generate.isPending}
                />
              </div>
              <div className="sm:col-span-3 text-xs text-muted-foreground">{dateSourceHelper}</div>
              {phaseDateInvalid && (
                <div className="sm:col-span-3 flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                  <span>Phase end date cannot be before phase start date.</span>
                </div>
              )}
            </div>
            )}

            {/* Template checklist / structure */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {isManage ? "Template structure" : "Generate from template"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedInitiativeCount} initiative{selectedInitiativeCount === 1 ? "" : "s"} ·{" "}
                  {selectedStdCount} template task{selectedStdCount === 1 ? "" : "s"}
                  {customCount > 0 ? ` · ${customCount} custom task${customCount === 1 ? "" : "s"}` : ""}
                </div>
              </div>
              {isManage && (
                <p className="text-xs text-muted-foreground">
                  Checkboxes mark which tasks are selected by default when this template is used. Adding,
                  editing, or removing tasks here does not change any existing Adoption Plan.
                </p>
              )}
              {isGenerate && (
                <p className="text-xs text-muted-foreground">
                  Checkboxes choose which template tasks will be created for this project when you generate
                  the Adoption Plan. To edit the reusable template itself, use Manage templates.
                </p>
              )}

              {preview.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : previewInitiatives.length === 0 ? (
                <p className="text-xs text-muted-foreground">Template preview unavailable.</p>
              ) : (
                <div className="space-y-2">
                  {previewInitiatives.map((init) => {
                    const Icon = READINESS_AREA_ICON[init.readiness_area] ?? Sparkles;
                    const expanded = expandedInits.has(init.key);
                    const totalTasks = init.tasks?.length ?? 0;
                    const selectedHere = (init.tasks ?? []).filter((t) =>
                      selectedKeys.has(`${init.key}.${t.key}`),
                    ).length;
                    const customs = customTasksByInit[init.key] ?? [];
                    const savedCustoms = customs.filter((c) => !c.isDraft && c.title.trim().length > 0);
                    const draftCount = customs.filter((c) => c.isDraft).length;
                    const selectedCustoms = savedCustoms.filter((c) => c.selected).length;
                    const totalAll = totalTasks + savedCustoms.length;
                    const selectedAll = selectedHere + selectedCustoms;
                    const allChecked = totalAll > 0 && selectedAll === totalAll;
                    const someChecked = selectedAll > 0 && selectedAll < totalAll;
                    const setAll = (checked: boolean) => {
                      setInitiativeAll(init.key, checked);
                      if (savedCustoms.length > 0) {
                        setCustomTasksByInit((prev) => ({
                          ...prev,
                          [init.key]: (prev[init.key] ?? []).map((c) =>
                            !c.isDraft && c.title.trim().length > 0 ? { ...c, selected: checked } : c,
                          ),
                        }));
                      }
                    };
                    return (
                      <div key={init.key} className="rounded-md border border-border">
                        <div className="flex items-center gap-2 p-3">
                          <Checkbox
                            checked={allChecked ? true : someChecked ? "indeterminate" : false}
                            onCheckedChange={(v) => setAll(v === true)}
                            disabled={!canEdit || generate.isPending || totalAll === 0}
                            aria-label={`Select all ${init.name} tasks`}
                          />
                          <button
                            type="button"
                            className="flex items-center gap-2 flex-1 min-w-0 text-left"
                            onClick={() => toggleExpanded(init.key)}
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <Icon className="h-4 w-4 text-primary" />
                            <span className="font-medium text-sm truncate">{init.name}</span>
                          </button>
                          <Badge variant="outline" className="text-[10px]">
                            {selectedHere} / {totalTasks} tasks
                          </Badge>
                          {savedCustoms.length > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              {selectedCustoms} / {savedCustoms.length} custom
                            </Badge>
                          )}
                          {draftCount > 0 && (
                            <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-600">
                              {draftCount} unsaved
                            </Badge>
                          )}
                        </div>
                        {expanded && (
                          <div className="border-t border-border p-3 space-y-3">
                            {init.summary && (
                              <p className="text-xs text-muted-foreground">{init.summary}</p>
                            )}
                            <div className="space-y-1.5">
                              {(init.tasks ?? []).map((t) => {
                                const k = `${init.key}.${t.key}`;
                                const checked = selectedKeys.has(k);
                                const isEditing = editingTaskKey === k;
                                if (isEditing && isManage) {
                                  return (
                                    <div key={k} className="rounded-md border border-dashed border-border bg-muted/30 p-2 space-y-2">
                                      <Input
                                        value={editDraft.title}
                                        onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                                        className="h-8 font-medium"
                                        autoFocus
                                      />
                                      <Textarea
                                        rows={1}
                                        value={editDraft.description}
                                        placeholder="Optional description"
                                        onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                                        className="text-xs min-h-[32px]"
                                      />
                                      <div className="flex items-center justify-end gap-2">
                                        <Button variant="ghost" size="sm" onClick={cancelEditTask}>
                                          <X className="h-3.5 w-3.5 mr-1" /> Cancel
                                        </Button>
                                        <Button size="sm" onClick={() => saveEditTask(init.key, t.key)} disabled={!editDraft.title.trim()}>
                                          <Check className="h-3.5 w-3.5 mr-1" /> Save
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={k} className="flex items-start gap-2 text-sm group">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleTaskKey(k)}
                                      disabled={!canEdit || isPending}
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium">{t.title}</div>
                                      {t.description && (
                                        <div className="text-xs text-muted-foreground">{t.description}</div>
                                      )}
                                    </div>
                                    {isManage && !isSystemTemplate && canEdit && (
                                      <>
                                        <Button
                                          variant="ghost" size="sm"
                                          onClick={() => startEditTask(init.key, t.key, t.title, t.description ?? null)}
                                          disabled={isPending} aria-label="Edit task"
                                          className="shrink-0 opacity-60 hover:opacity-100"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                          variant="ghost" size="sm"
                                          onClick={() => removeTemplateTask(init.key, t.key)}
                                          disabled={isPending} aria-label="Remove task"
                                          className="shrink-0 opacity-60 hover:opacity-100"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                );
                              })}


                              {/* Saved custom tasks — same visual style as template tasks */}
                              {customs.filter((c) => !c.isDraft && c.title.trim().length > 0).map((c) => (
                                <div key={c.id} className="flex items-start gap-2 text-sm group">
                                  <Checkbox
                                    checked={c.selected}
                                    onCheckedChange={(v) =>
                                      updateCustomTask(init.key, c.id, { selected: v === true })
                                    }
                                    disabled={!canEdit || generate.isPending}
                                    aria-label="Select custom task"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{c.title}</span>
                                      <Badge variant="outline" className="text-[10px] shrink-0">
                                        Custom
                                      </Badge>
                                    </div>
                                    {c.description && (
                                      <div className="text-xs text-muted-foreground">{c.description}</div>
                                    )}
                                  </div>
                                  {isManage && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => editCustomTask(init.key, c.id)}
                                        disabled={!canEdit || generate.isPending}
                                        aria-label="Edit custom task"
                                        className="shrink-0 opacity-60 hover:opacity-100"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeCustomTask(init.key, c.id)}
                                        disabled={!canEdit || generate.isPending}
                                        aria-label="Remove custom task"
                                        className="shrink-0 opacity-60 hover:opacity-100"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Draft custom tasks — only in manage mode */}
                            {isManage && (
                            <div className="space-y-2">
                              {customs.filter((c) => c.isDraft).map((c) => {
                                const draftTitle = c.draftTitle ?? "";
                                const canSave = draftTitle.trim().length > 0;
                                return (
                                  <div
                                    key={c.id}
                                    className="rounded-md border border-dashed border-border bg-muted/30 p-2 space-y-2"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Input
                                        placeholder="Custom task title"
                                        value={draftTitle}
                                        onChange={(e) =>
                                          updateCustomTask(init.key, c.id, { draftTitle: e.target.value })
                                        }
                                        disabled={!canEdit || generate.isPending}
                                        className="h-8 font-medium"
                                        autoFocus
                                      />
                                      <Badge variant="outline" className="text-[10px] shrink-0">
                                        Custom
                                      </Badge>
                                    </div>
                                    <Textarea
                                      placeholder="Optional description"
                                      rows={1}
                                      value={c.draftDescription ?? ""}
                                      onChange={(e) =>
                                        updateCustomTask(init.key, c.id, {
                                          draftDescription: e.target.value,
                                        })
                                      }
                                      disabled={!canEdit || generate.isPending}
                                      className="text-xs min-h-[32px]"
                                    />
                                    <div className="flex items-center justify-end gap-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeCustomTask(init.key, c.id)}
                                        disabled={!canEdit || generate.isPending}
                                      >
                                        <X className="h-3.5 w-3.5 mr-1" /> Cancel
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={() => saveCustomTask(init.key, c.id)}
                                        disabled={!canEdit || generate.isPending || !canSave}
                                      >
                                        <Check className="h-3.5 w-3.5 mr-1" /> Save
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                              {isSystemTemplate ? (
                                <div className="flex items-center gap-2 pt-1">
                                  <Button variant="outline" size="sm" disabled className="opacity-60">
                                    <Lock className="h-3.5 w-3.5 mr-1" /> Add custom task
                                  </Button>
                                  <span className="text-xs text-muted-foreground">
                                    Create a custom template to customize tasks.
                                  </span>
                                </div>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => addCustomTask(init.key)}
                                  disabled={!canEdit || isPending}
                                >
                                  <Plus className="h-3.5 w-3.5 mr-1" /> Add custom task
                                </Button>
                              )}
                            </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {isGenerate && (
              <>
                <p className="text-xs text-muted-foreground">
                  Generated adoption work becomes normal BTPM tasks. After generation, edit task names,
                  owners, dates, status, and priority in Planning. To add more adoption work later, open
                  Templates again and use Add tasks from template, or link a normal task in Planning.
                </p>

                {canEdit ? (
                  <Button onClick={handleGenerate} disabled={generateDisabled}>
                    <Sparkles className="h-4 w-4 mr-1" />
                    {isPending ? "Generating…" : "Generate Adoption Plan"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    You have read-only access to this project. Ask a project manager or workspace admin to
                    generate the Adoption Plan.
                  </p>
                )}
                {totalSelected === 0 && canEdit && (
                  <p className="text-xs text-muted-foreground">
                    Select at least one task to enable Generate.
                  </p>
                )}
                {hasUnsavedTemplateChanges && canEdit && (
                  <p className="text-xs text-orange-600">
                    You have unsaved template changes in Manage templates. Save or discard them so the
                    Adoption Plan uses the latest template.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* CM.7B — Create / Save-as template dialog (used by Manage templates) */}
        <Dialog open={createDialogOpen} onOpenChange={(o) => !createTemplate.isPending && setCreateDialogOpen(o)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Save as workspace template</DialogTitle>
              <DialogDescription>
                Saves the current template content (initiatives and tasks) as a reusable workspace Adoption
                Template. The BTPM Standard Template is not modified.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-tpl-name">Template name</Label>
                <Input
                  id="new-tpl-name"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  maxLength={200}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-tpl-desc">Description (optional)</Label>
                <Textarea
                  id="new-tpl-desc"
                  rows={3}
                  value={newTemplateDescription}
                  onChange={(e) => setNewTemplateDescription(e.target.value)}
                  maxLength={2000}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateDialogOpen(false)} disabled={createTemplate.isPending}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateTemplate}
                disabled={createTemplate.isPending || !newTemplateName.trim()}
              >
                {createTemplate.isPending ? "Saving…" : "Save template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  };

  // Manage templates Sheet — opened from the Templates sub-tab in both
  // pre-plan and post-plan states. Holds template structure editing only;
  // never shows project duplicate status or Generate controls.
  const renderManageTemplatesSheet = () => (
    <Sheet open={manageSheetOpen} onOpenChange={setManageSheetOpen}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Manage templates</SheetTitle>
          <SheetDescription>
            Reusable workspace Adoption templates. Edits here do not change this project's generated
            Adoption Plan.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {renderTemplatesEditor("manage")}
        </div>
      </SheetContent>
    </Sheet>
  );

  const manageTemplatesButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setManageSheetOpen(true)}
    >
      <Settings2 className="h-4 w-4 mr-1" /> Manage templates
    </Button>
  );



  // ============================================================
  // STATE 1 — No Adoption Plan (selectable wizard)
  // ============================================================
  if (!hasPlan) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Adoption Plan</h2>
          <p className="text-sm text-muted-foreground">
            Plan and track the people-side work needed for this project to be adopted successfully.
          </p>
        </div>

        <Tabs value={subTab} onValueChange={(v) => setSubTab(v as "plan" | "templates")}>
          <TabsList>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>

          <TabsContent value="plan" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">No Adoption Plan yet</CardTitle>
                <CardDescription>
                  Choose or customize a template in the Templates tab to generate this project's Adoption Plan.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" onClick={() => setSubTab("templates")}>
                  Go to Templates
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates" className="mt-4 space-y-4">
            <div className="flex justify-end">{manageTemplatesButton}</div>
            {renderTemplatesEditor("apply-generate")}
            {renderManageTemplatesSheet()}
          </TabsContent>
        </Tabs>
      </div>
    );
  }


  // ============================================================
  // STATE 2 — Adoption Plan exists
  // ============================================================
  const plan = substrate.data!.adoptionPlan!;
  const initiatives = substrate.data!.initiatives;
  const linkedTaskCounts = substrate.data!.linkedTaskCounts;
  const linkedObjectCounts = substrate.data!.linkedObjectCounts;

  const overdueByInitiative = (initiativeId: string) => {
    const now = Date.now();
    return adoptionTasks.filter(
      (t) =>
        t.adoption_initiative_id === initiativeId &&
        t.due_date &&
        new Date(t.due_date).getTime() < now &&
        t.status !== "completed" &&
        t.status !== "cancelled" &&
        t.status !== "done",
    ).length;
  };

  const riskCount = linkedObjectCounts["risk"] ?? 0;
  const blockerCount = linkedObjectCounts["blocker"] ?? 0;
  const kpiCount = linkedObjectCounts["kpi"] ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Adoption Plan</h2>
          <p className="text-sm text-muted-foreground">
            People-side adoption lens for this project. Execution lives in normal Planning tasks.
          </p>
        </div>
        <div className="flex gap-2">
          {plan.created_from_template && <Badge variant="outline">From template</Badge>}
          <Badge variant={plan.enabled ? "default" : "outline"}>{plan.enabled ? "Enabled" : "Disabled"}</Badge>
        </div>
      </div>

      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as "plan" | "templates")}>
        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="mt-4 space-y-6">
      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-muted-foreground">Readiness status:</span>
            <StatusBadge value={plan.readiness_status} />
          </div>
          {plan.objective && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Objective</div>
              <p className="whitespace-pre-wrap">{plan.objective}</p>
            </div>
          )}
          {plan.impacted_audience_summary && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Impacted audience</div>
              <p className="whitespace-pre-wrap">{plan.impacted_audience_summary}</p>
            </div>
          )}
          {plan.approach_summary && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Approach</div>
              <p className="whitespace-pre-wrap">{plan.approach_summary}</p>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Created {formatDate(plan.created_at)}
            {plan.updated_at && plan.updated_at !== plan.created_at
              ? ` · Updated ${formatDate(plan.updated_at)}`
              : ""}
          </div>
        </CardContent>
      </Card>

      {/* CM.7C — Adoption tasks grouped by initiative.
          Replaces the previous duplicated "Readiness snapshot" and
          "Adoption initiatives" panels. Tasks shown are normal BTPM tasks. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Adoption tasks</CardTitle>
            <CardDescription>
              Generated and linked Planning tasks grouped by Adoption initiative. These remain normal BTPM tasks.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/workspace/${workspaceId}/project/${projectId}/planning`}>
              <ExternalLink className="h-4 w-4 mr-1" /> Open Planning
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {tasks.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : adoptionTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Adoption tasks are linked yet. Generate tasks from a template or link existing Planning tasks below.
            </p>
          ) : (
            (() => {
              // Group tasks by initiative id (or general bucket)
              const GENERAL = "__general__";
              const groups = new Map<string, any[]>();
              for (const t of adoptionTasks) {
                const key = t.adoption_initiative_id || GENERAL;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(t);
              }
              // Order: initiatives in substrate order, then general last.
              const orderedKeys: string[] = [
                ...initiatives.map((i: AdoptionInitiative) => i.id).filter((id) => groups.has(id)),
                ...(groups.has(GENERAL) ? [GENERAL] : []),
              ];
              return orderedKeys.map((key) => {
                const list = groups.get(key) ?? [];
                const initiative =
                  key === GENERAL
                    ? null
                    : initiatives.find((i: AdoptionInitiative) => i.id === key) ?? null;
                const groupName = initiative?.name ?? "General Adoption Plan";
                const Icon =
                  READINESS_AREA_ICON[initiative?.readiness_area ?? ""] ?? Sparkles;
                return (
                  <div key={key} className="rounded-md border border-border">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">{groupName}</span>
                      {initiative && <StatusBadge value={initiative.status} />}
                      {initiative && <PriorityBadge value={initiative.priority} />}
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {list.length} task{list.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <div className="divide-y divide-border">
                      {list.map((t: any) => {
                        const overdue =
                          t.due_date &&
                          new Date(t.due_date).getTime() < Date.now() &&
                          t.status !== "completed" &&
                          t.status !== "cancelled" &&
                          t.status !== "done";
                        const owner = t.owner_id ? membersMap[t.owner_id] ?? null : null;
                        return (
                          <div
                            key={t.id}
                            className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm hover:bg-accent/30"
                          >
                            <Link
                              to={`/workspace/${workspaceId}/project/${projectId}/task/${t.id}?from=adoption`}
                              className="flex flex-wrap items-center gap-2 flex-1 min-w-0"
                            >
                              <span className="font-medium truncate max-w-[40%]">{t.name}</span>
                              <StatusBadge value={t.status} />
                              <PriorityBadge value={t.priority} />
                              {t.phase_id && phaseNameById[t.phase_id] && (
                                <Badge variant="outline" className="text-[10px]">
                                  {phaseNameById[t.phase_id]}
                                </Badge>
                              )}
                              {owner && (
                                <span className="text-xs text-muted-foreground">Owner: {owner}</span>
                              )}
                              {t.start_date && (
                                <span className="text-xs text-muted-foreground">{t.start_date}</span>
                              )}
                              {t.due_date && (
                                <span
                                  className={`text-xs ${
                                    overdue ? "text-destructive" : "text-muted-foreground"
                                  }`}
                                >
                                  → {formatDate(t.due_date)}
                                  {overdue ? " · overdue" : ""}
                                </span>
                              )}
                            </Link>
                            <Button variant="ghost" size="sm" asChild title="Open in Planning">
                              <Link
                                to={`/workspace/${workspaceId}/project/${projectId}/task/${t.id}?from=adoption`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async (e) => {
                                  e.preventDefault();
                                  try {
                                    await unlinkTask.mutateAsync({ taskId: t.id });
                                    toast.success("Task removed from Adoption Plan.");
                                  } catch (err: any) {
                                    toast.error(
                                      err?.message ?? "Could not remove this task from the Adoption Plan.",
                                    );
                                  }
                                }}
                                disabled={unlinkTask.isPending}
                              >
                                <X className="h-3.5 w-3.5 mr-1" /> Remove
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()
          )}
        </CardContent>
      </Card>


      {/* Manage adoption links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manage adoption links</CardTitle>
          <CardDescription>
            Connect existing project tasks, risks, blockers, and KPIs to the Adoption Plan. This does not duplicate them or create a separate plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              You have read-only access. Adoption links can be managed by project managers or workspace admins.
            </p>
          )}

          {canEdit && (
            <>
              {/* Link existing task */}
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium">Link existing task</div>
                  <div className="text-xs text-muted-foreground">
                    Marks the task as adoption-related. Does not change its status, dates, owner, or phase.
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
                  <Select value={selectedTaskId} onValueChange={setSelectedTaskId} disabled={candidateTasks.length === 0 || linkTask.isPending}>
                    <SelectTrigger>
                      <SelectValue placeholder={tasks.isLoading ? "Loading tasks…" : candidateTasks.length === 0 ? "No tasks available" : "Select a task"} />
                    </SelectTrigger>
                    <SelectContent>
                      {candidateTasks.map((t: any) => {
                        const phase = t.phase_id ? phaseNameById[t.phase_id] ?? "" : "";
                        const already = t.is_adoption_related;
                        return (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                            {phase ? ` · ${phase}` : ""}
                            {t.status ? ` · ${t.status}` : ""}
                            {already ? " · already linked" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Select value={selectedTaskInitiative} onValueChange={setSelectedTaskInitiative} disabled={linkTask.isPending}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an initiative" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GENERAL_INITIATIVE_VALUE}>General Adoption Plan</SelectItem>
                      {initiatives.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name ?? "Initiative"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={async () => {
                      if (!selectedTaskId) return;
                      try {
                        await linkTask.mutateAsync({
                          taskId: selectedTaskId,
                          adoptionInitiativeId: selectedTaskInitiative === GENERAL_INITIATIVE_VALUE ? null : selectedTaskInitiative,
                        });
                        toast.success("Task linked to Adoption Plan.");
                        setSelectedTaskId("");
                      } catch (err: any) {
                        toast.error(err?.message ?? "Could not link this task to the Adoption Plan.");
                      }
                    }}
                    disabled={!selectedTaskId || linkTask.isPending}
                  >
                    <Link2 className="h-4 w-4 mr-1" /> Link task
                  </Button>
                </div>
              </div>

              {/* Link risk/blocker/KPI */}
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium">Link risk, blocker, or KPI</div>
                  <div className="text-xs text-muted-foreground">
                    Connects an existing canonical object to the Adoption Plan. The object is not duplicated or modified.
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[140px,1fr,1fr,auto]">
                  <Select value={selectedObjectType} onValueChange={(v) => { setSelectedObjectType(v as AdoptionObjectType); setSelectedObjectId(""); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="risk">Risk</SelectItem>
                      <SelectItem value="blocker">Blocker</SelectItem>
                      <SelectItem value="kpi">KPI</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={selectedObjectId} onValueChange={setSelectedObjectId} disabled={candidateObjects.length === 0 || linkObject.isPending}>
                    <SelectTrigger>
                      <SelectValue placeholder={candidateObjectsLoading ? "Loading…" : candidateObjects.length === 0 ? "No items available" : "Select an item"} />
                    </SelectTrigger>
                    <SelectContent>
                      {candidateObjects.map((o) => (
                        <SelectItem key={o.id} value={o.id} disabled={o.alreadyLinked}>
                          {o.label}{o.alreadyLinked ? " · already linked" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={selectedObjectInitiative} onValueChange={setSelectedObjectInitiative} disabled={linkObject.isPending}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an initiative" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GENERAL_INITIATIVE_VALUE}>General Adoption Plan</SelectItem>
                      {initiatives.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name ?? "Initiative"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={async () => {
                      if (!selectedObjectId || !plan) return;
                      try {
                        await linkObject.mutateAsync({
                          adoptionPlanId: plan.id,
                          objectType: selectedObjectType,
                          objectId: selectedObjectId,
                          adoptionInitiativeId: selectedObjectInitiative === GENERAL_INITIATIVE_VALUE ? null : selectedObjectInitiative,
                        });
                        const labelMap: Record<AdoptionObjectType, string> = {
                          risk: "Risk linked to Adoption Plan.",
                          blocker: "Blocker linked to Adoption Plan.",
                          kpi: "KPI linked to Adoption Plan.",
                        };
                        toast.success(labelMap[selectedObjectType]);
                        setSelectedObjectId("");
                      } catch (err: any) {
                        toast.error(err?.message ?? "Could not link this item to the Adoption Plan.");
                      }
                    }}
                    disabled={!selectedObjectId || linkObject.isPending}
                  >
                    <Link2 className="h-4 w-4 mr-1" /> Link item
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Linked objects (grouped) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Linked objects</CardTitle>
          <CardDescription>Risks, blockers, and KPIs connected to the Adoption Plan. Canonical objects remain in their own modules.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {linkedGroups.risk.length + linkedGroups.blocker.length + linkedGroups.kpi.length === 0 ? (
            <p className="text-muted-foreground">
              No risks, blockers, or KPIs have been linked to the Adoption Plan yet.
            </p>
          ) : (
            (["risk", "blocker", "kpi"] as AdoptionObjectType[]).map((type) => {
              const items = linkedGroups[type];
              if (items.length === 0) return null;
              const title = type === "risk" ? "Adoption risks" : type === "blocker" ? "Adoption blockers" : "Adoption KPIs";
              return (
                <div key={type} className="space-y-2">
                  <div className="text-xs uppercase text-muted-foreground">{title}</div>
                  {items.map((row) => (
                    <div key={row.link.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
                      <span className="font-medium">{row.label}</span>
                      {row.details.map((d, idx) => (
                        <Badge key={idx} variant="outline" className="text-[10px] capitalize">{d}</Badge>
                      ))}
                      <Badge variant="outline" className="text-[10px]">
                        {row.link.adoption_initiative_id && initiativeNameById[row.link.adoption_initiative_id]
                          ? initiativeNameById[row.link.adoption_initiative_id]
                          : "General Adoption Plan"}
                      </Badge>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto"
                          onClick={async () => {
                            try {
                              await unlinkObject.mutateAsync({ linkId: row.link.id });
                              toast.success("Adoption link removed.");
                            } catch (err: any) {
                              toast.error(err?.message ?? "Could not remove this adoption link.");
                            }
                          }}
                          disabled={unlinkObject.isPending}
                        >
                          <X className="h-3.5 w-3.5 mr-1" /> Unlink
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value="templates" className="mt-4 space-y-4">
          <div className="flex justify-end">{manageTemplatesButton}</div>
          <AddTasksFromTemplatePanel
            projectId={projectId!}
            workspaceId={workspaceId!}
            canEdit={canEdit}
            existingAdoptionTasks={adoptionTasks.map((t: any) => ({
              id: t.id,
              name: t.name,
              adoption_initiative_id: t.adoption_initiative_id ?? null,
            }))}
            initiativeReadinessById={Object.fromEntries(
              (substrate.data?.initiatives ?? []).map((i: any) => [i.id, i.readiness_area]),
            )}
          />
          {renderManageTemplatesSheet()}
        </TabsContent>
      </Tabs>
    </div>
  );
}


