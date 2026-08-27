import { useMemo, useRef, useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  FileJson,
  Upload,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  ClipboardPaste,
  Lock,
  ServerCog,
  Info,
  History,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  TEMPLATES,
  toJsonString,
  validateImportPayload,
  type ValidationResult,
  OBJECT_FAMILIES,
} from "@/lib/imports/btpmImportV1";

interface AdminCtx {
  organizationId: string;
}

interface ServerIssue {
  severity: "error" | "warning";
  code: string;
  family?: string;
  index?: number;
  external_key?: string;
  field?: string;
  message: string;
}

interface ServerPlan {
  programs_to_create: number;
  programs_to_reuse: number;
  projects_to_create: number;
  phases_to_create: number;
  tasks_to_create: number;
  project_team_members_to_create: number;
  task_assignments_to_create: number;
  risks_to_create: number;
  blockers_to_create: number;
  execution_updates_to_create: number;
  // TAE.11A v2 additive plan counts (0 for v1 payloads).
  project_stakeholders_to_create?: number;
  task_requester_links_to_create?: number;
  task_executor_links_to_create?: number;
}

interface ServerResult {
  ok: boolean;
  batch_id: string | null;
  summary: {
    schema_version: string;
    import_type: string;
    source_name: string | null;
    workspace_id: string;
    workspace_name: string | null;
    counts: Record<string, number>;
    plan: ServerPlan | null;
  };
  errors: ServerIssue[];
  warnings: ServerIssue[];
  defaults: ServerIssue[];
}

interface CommitResult {
  ok: boolean;
  batch_id: string | null;
  summary?: {
    programs_created?: number;
    programs_reused?: number;
    projects_created?: number;
    phases_created?: number;
    tasks_created?: number;
    project_team_members_created?: number;
    task_assignments_created?: number;
    risks_created?: number;
    blockers_created?: number;
    execution_updates_created?: number;
  };
  created?: {
    programs?: Array<{ id: string; external_key?: string }>;
    projects?: Array<{ id: string; external_key?: string }>;
    phases?: Array<{ id: string; external_key?: string }>;
    tasks?: Array<{ id: string; external_key?: string }>;
  };
  errors?: ServerIssue[];
  warnings?: ServerIssue[];
  message?: string;
}

interface ImportBatchRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  workspace_name: string | null;
  requested_by: string | null;
  requested_by_email: string | null;
  requested_by_display_name: string | null;
  schema_version: string;
  import_type: string;
  source_name: string | null;
  source_file_name: string | null;
  payload_hash: string | null;
  status: string;
  counts_json: Record<string, number> | null;
  safe_summary_json: Record<string, unknown> | null;
  safe_issue_summary_json: Record<string, unknown> | null;
  created_at: string;
  dry_run_at: string | null;
  committed_at: string | null;
}

const FAMILY_LABELS: Record<(typeof OBJECT_FAMILIES)[number], string> = {
  programs: "Programs",
  projects: "Projects",
  project_team_members: "Project team members",
  phases: "Phases",
  tasks: "Tasks",
  task_assignments: "Task assignments",
  risks: "Risks",
  blockers: "Blockers",
  execution_updates: "Execution updates",
};

// Canonical JSON stringify — MUST match the server SHA-256 input.
function canonicalStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalStringify((v as any)[k]))
      .join(",") +
    "}"
  );
}

function downloadJson(fileName: string, content: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Human-friendly explanation + fix hint for each stable import validation
 * code. Keeps the raw code/message visible for debugging, and adds a plain
 * English "what this means" + "how to fix" line so Admins can act on
 * dry-run/commit errors without reading engineering docs.
 */
const CODE_EXPLANATIONS: Record<string, { what: string; fix: string }> = {
  // Structural / envelope
  invalid_schema_version: { what: "The file's schema_version isn't the one this app accepts.", fix: 'Set "schema_version" to "btpm_import_v1".' },
  invalid_import_type: { what: "The file's import_type isn't a workspace import.", fix: 'Set "import_type" to "pm_workspace_import".' },
  missing_required_array: { what: "One of the top-level object families is missing.", fix: "Add the array (can be empty []) for the named family." },
  missing_required_field: { what: "A required field is missing on this row.", fix: "Fill the named field in the JSON row." },
  invalid_enum: { what: "The value isn't one of the allowed options.", fix: "Use one of the allowed values shown in the message." },
  invalid_date: { what: "The date isn't in ISO YYYY-MM-DD format.", fix: "Rewrite the date as YYYY-MM-DD (e.g. 2026-07-01)." },
  invalid_email: { what: "This email address isn't valid.", fix: "Correct the email so it looks like name@domain." },
  duplicate_external_key: { what: "Two rows in the same family share the same external_key.", fix: "Make each external_key unique within its family." },
  duplicate_name_in_payload: { what: "Two rows have the same name in the same scope (case/whitespace-insensitive).", fix: "Rename one of them, or merge the duplicates before uploading." },
  // References / containment
  broken_reference: { what: "This row points to a parent (program, project, phase, or task) that isn't defined in this file.", fix: "Add the parent to the file, or fix the *_external_key so it matches an existing key." },
  target_not_resolved: { what: "This risk / blocker / update targets an object that isn't defined in this file.", fix: "Add the target object to the file, or point target_external_key at an existing external_key of the right target_type." },
  phase_project_mismatch: { what: "The task's phase belongs to a different project than the task itself.", fix: "Either move the task to the phase's project, or point phase_external_key at a phase in the task's project." },
  project_date_range_invalid: { what: "The project's planned_end is before its planned_start.", fix: "Swap or correct planned_start / planned_end so end ≥ start." },
  phase_date_range_invalid: { what: "The phase's planned_end is before its planned_start.", fix: "Swap or correct planned_start / planned_end so end ≥ start." },
  task_date_range_invalid: { what: "The task's due_date is before its planned_start.", fix: "Swap or correct planned_start / due_date so due_date ≥ start." },
  phase_before_project_start: { what: "The phase starts before its parent project starts.", fix: "Move the phase start on or after the project's planned_start, or move the project start earlier." },
  phase_after_project_end: { what: "The phase ends after its parent project ends.", fix: "Move the phase end on or before the project's planned_end, or extend the project's planned_end." },
  task_before_phase_start: { what: "The task starts before its parent phase starts.", fix: "Move the task's planned_start on or after the phase's planned_start, or move the phase start earlier." },
  task_after_phase_end: { what: "The task's due_date is after its parent phase ends.", fix: "Move the task's due_date on or before the phase's planned_end, or extend the phase." },
  task_before_project_start: { what: "The task starts before its parent project starts.", fix: "Move the task's planned_start on or after the project's planned_start." },
  task_after_project_end: { what: "The task's due_date is after its parent project ends.", fix: "Move the task's due_date on or before the project's planned_end, or extend the project." },
  // DB / workspace
  project_name_conflict: { what: "A project with the same name already exists in the target workspace. This import step is create-only.", fix: "Rename the incoming project, or delete/rename the existing one, then re-run dry-run." },
  program_will_be_reused: { what: "A program with the same name already exists — the import will reuse it instead of creating a duplicate.", fix: "No action needed. Rename the incoming program if you want a new program instead." },
  user_not_found: { what: "No active user profile exists for this email address.", fix: "Invite/activate the user in the organization first, or correct the email." },
  user_inactive: { what: "The user exists but isn't an active member of this organization.", fix: "Reactivate the user's org membership, or use a different email." },
  user_not_in_workspace: { what: "The user isn't a member of the target workspace.", fix: "Add the user to the workspace, or use an email that already is." },
  // Warnings
  suspicious_timeline_label_task: { what: "This task's name looks like a month/quarter/year header rather than a real task — likely a leftover row from a deck conversion.", fix: "Remove or rename the row so real tasks aren't polluted with timeline headers." },
  empty_phase: { what: "This phase has no tasks in the file.", fix: "Add tasks under this phase, or remove the phase if it's intentionally empty." },
  project_without_phases: { what: "This project has no phases in the file.", fix: "Add phases (and tasks) for the project, or plan to add them after import." },
  execution_update_date_outside_target_window: { what: "The update_date is more than 30 days outside the target's planned window.", fix: "Confirm the date is correct — historical/retrospective updates are allowed but this one looks unusual." },
  owner_email_not_persisted: { what: "The risks/blockers tables don't have an owner column yet, so owner_email is validated but not stored.", fix: "No action needed — track ownership through comments or assignments for now." },
  canonical_role_key_not_persisted: { what: "canonical_role_key isn't stored yet — only role_label is persisted.", fix: "No action needed — use role_label to describe the team role." },
  phase_type_not_persisted: { what: "phase_type isn't stored by the current commit path.", fix: "No action needed — the field is accepted but ignored." },
  default_will_be_applied: { what: "A default value will be applied at commit because the field was omitted.", fix: "No action needed unless you want a specific value — then set it in the JSON." },
};

function IssueList({
  title,
  color,
  issues,
}: {
  title: string;
  color: "destructive" | "amber" | "blue";
  issues: (ServerIssue | { severity: string; message: string; family?: string; index?: number; external_key?: string; field?: string; path?: string; code?: string })[];
}) {
  if (issues.length === 0) return null;
  const borderClass =
    color === "destructive"
      ? "border-destructive"
      : color === "amber"
      ? "border-amber-500"
      : "border-blue-500";
  const headClass =
    color === "destructive"
      ? "text-destructive"
      : color === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : "text-blue-700 dark:text-blue-400";

  // Group by stable code so 32 rows collapse into a handful of headings the
  // Admin can read at a glance. Client-only issues without a code fall into
  // a per-family bucket.
  const groups = new Map<
    string,
    {
      code: string;
      family: string;
      sample: (typeof issues)[number];
      items: typeof issues;
    }
  >();
  for (const it of issues) {
    const any = it as any;
    const code: string = any.code ?? `client:${any.family ?? "envelope"}`;
    const family: string = any.family ?? "envelope";
    const key = `${code}::${family}`;
    const bucket = groups.get(key);
    if (bucket) bucket.items.push(it);
    else groups.set(key, { code, family, sample: it, items: [it] });
  }
  const buckets = Array.from(groups.values()).sort((a, b) => b.items.length - a.items.length);

  return (
    <div>
      <Separator className="my-3" />
      <h4 className={`text-sm font-semibold mb-2 ${headClass}`}>
        {title} ({issues.length})
      </h4>
      <div className="space-y-3">
        {buckets.map((b, gi) => {
          const explain = CODE_EXPLANATIONS[b.code];
          const label = explain ? undefined : (b.sample as any).message;
          return (
            <div key={gi} className={`border-l-2 pl-3 ${borderClass}`}>
              <div className="text-sm font-medium text-foreground">
                {explain ? explain.what : label}
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({b.items.length} in {b.family} · {b.code})
                </span>
              </div>
              {explain?.fix && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium">How to fix:</span> {explain.fix}
                </div>
              )}
              <ul className="mt-1.5 space-y-1 text-xs">
                {b.items.slice(0, 8).map((e, i) => {
                  const anyE = e as any;
                  return (
                    <li key={i} className="text-muted-foreground">
                      <span className="font-mono text-[11px]">
                        {anyE.family ?? "envelope"}
                        {typeof anyE.index === "number" ? `[${anyE.index}]` : ""}
                        {anyE.external_key ? ` · ${anyE.external_key}` : ""}
                        {anyE.field ? ` · ${anyE.field}` : anyE.path ? ` · ${anyE.path}` : ""}
                      </span>
                      <span className="ml-2 text-foreground">{e.message}</span>
                    </li>
                  );
                })}
                {b.items.length > 8 && (
                  <li className="text-muted-foreground">
                    …and {b.items.length - 8} more of the same type.
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export default function AdminImports() {
  const { toast } = useToast();
  const { organizationId } = useOutletContext<AdminCtx>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState<string>("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [serverResult, setServerResult] = useState<ServerResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [dryRunSnapshot, setDryRunSnapshot] = useState<{
    payloadJson: string;
    workspaceId: string;
    batchId: string;
  } | null>(null);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const workspacesQ = useQuery({
    queryKey: ["admin-org-workspaces-imports", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_org_workspaces", {
        _organization_id: organizationId,
      });
      if (error) throw error;
      return ((data ?? []) as { id: string; name: string }[]);
    },
  });

  const historyQ = useQuery({
    queryKey: ["admin-btpm-import-history", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "admin_list_btpm_import_batches",
        { _organization_id: organizationId },
      );
      if (error) throw error;
      return (data ?? []) as ImportBatchRow[];
    },
  });
  const [expandedBatchIds, setExpandedBatchIds] = useState<Record<string, boolean>>({});

  const workspaces = useMemo(() => {
    const list = (workspacesQ.data ?? []).map((w) => ({ id: w.id, name: w.name }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [workspacesQ.data]);

  const canValidate = rawText.trim().length > 0;
  const canServerDryRun =
    !!workspaceId &&
    !!result &&
    result.ok &&
    !!result.data &&
    !serverBusy;

  const scopedOutCounts = useMemo(() => {
    const d: any = result?.data ?? {};
    return {
      risks: Array.isArray(d.risks) ? d.risks.length : 0,
      blockers: Array.isArray(d.blockers) ? d.blockers.length : 0,
      execution_updates: Array.isArray(d.execution_updates) ? d.execution_updates.length : 0,
    };
  }, [result]);
  const hasScopedOutRows =
    scopedOutCounts.risks + scopedOutCounts.blockers + scopedOutCounts.execution_updates > 0;

  const currentPayloadJson = useMemo(
    () => (result?.data ? canonicalStringify(result.data) : ""),
    [result],
  );
  // TAE.11B.1 — v2 commit is enabled; schema_version stays visible in the
  // batch history table. No frontend gate keyed on schema version.


  
  const canCommit =
    !!serverResult?.ok &&
    !!dryRunSnapshot &&
    !!serverResult?.batch_id &&
    dryRunSnapshot.batchId === serverResult?.batch_id &&
    dryRunSnapshot.workspaceId === workspaceId &&
    dryRunSnapshot.payloadJson === currentPayloadJson &&
    !commitBusy &&
    !commitResult?.ok;


  function handleDownload(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    downloadJson(t.fileName, toJsonString(t.build()));
    toast({ title: "Template downloaded", description: t.fileName });
  }

  function clearDownstream() {
    setServerResult(null);
    setServerError(null);
    setDryRunSnapshot(null);
    setCommitResult(null);
    setCommitError(null);
  }

  async function handleFile(file: File) {
    const text = await file.text();
    setRawText(text);
    setFileName(file.name);
    setResult(null);
    clearDownstream();
  }

  function handleValidate() {
    const r = validateImportPayload(rawText);
    setResult(r);
    clearDownstream();
    if (r.ok) {
      toast({ title: "Structure valid", description: "Client-side checks passed." });
    } else {
      toast({
        title: "Validation errors",
        description: `${r.errors.length} error(s) found.`,
        variant: "destructive",
      });
    }
  }

  async function handleServerDryRun() {
    if (!canServerDryRun || !result?.data) return;
    setServerBusy(true);
    setServerResult(null);
    setServerError(null);
    setDryRunSnapshot(null);
    setCommitResult(null);
    setCommitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("btpm-import-dry-run", {
        body: { organizationId, workspaceId, payload: result.data },
      });
      if (error) {
        setServerError(error.message || "Server dry-run failed.");
        toast({ title: "Server dry-run failed", description: error.message, variant: "destructive" });
      } else {
        const r = data as ServerResult;
        setServerResult(r);
        if (r.ok && r.batch_id && result.data) {
          setDryRunSnapshot({
            payloadJson: canonicalStringify(result.data),
            workspaceId,
            batchId: r.batch_id,
          });
        }
        toast({
          title: r.ok ? "Dry-run passed" : "Dry-run failed",
          description: r.ok
            ? "Server validation ok. You can commit next."
            : `${r.errors.length} error(s), ${r.warnings.length} warning(s).`,
          variant: r.ok ? undefined : "destructive",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setServerError(msg);
    } finally {
      setServerBusy(false);
      historyQ.refetch();
    }
  }

  async function handleCommit() {
    if (!canCommit || !result?.data || !dryRunSnapshot) return;
    setCommitBusy(true);
    setCommitResult(null);
    setCommitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("btpm-import-commit", {
        body: {
          organizationId,
          workspaceId,
          dryRunBatchId: dryRunSnapshot.batchId,
          payload: result.data,
        },
      });
      if (error) {
        setCommitError(error.message || "Commit failed.");
        toast({ title: "Commit failed", description: error.message, variant: "destructive" });
      } else {
        const r = data as CommitResult;
        setCommitResult(r);
        toast({
          title: r.ok ? "Import committed" : "Commit failed",
          description: r.ok
            ? "Core PM records were created."
            : r.errors?.[0]?.message ?? "No records were committed.",
          variant: r.ok ? undefined : "destructive",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCommitError(msg);
    } finally {
      setCommitBusy(false);
      historyQ.refetch();
    }
  }

  const committedWorkspaceName = useMemo(() => {
    if (!commitResult?.ok) return null;
    return workspaces.find((w) => w.id === workspaceId)?.name ?? null;
  }, [commitResult, workspaces, workspaceId]);
  useEffect(() => {
    // no-op — ensures useEffect import is used and future refresh hooks compose
  }, [organizationId]);


  const counts = result?.counts ?? null;
  const totalRows = useMemo(
    () => (counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0),
    [counts],
  );

  return (
    <div className="space-y-6">
      {/* Intro */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <FileJson className="h-6 w-6 text-primary mt-0.5" />
            <div>
              <CardTitle>Imports</CardTitle>
              <CardDescription className="mt-1">
                Import structured JSON into canonical BTPM records —{" "}
                <span className="font-medium">
                  Programs, Projects, Phases, Tasks, Team, Assignments, Risks, Blockers,
                  Execution updates
                </span>
                . Reporting stays derived; nothing here creates downstream totals or
                launch-specific tables.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">What can be imported</h3>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>Programs, Projects, Phases, Tasks</li>
              <li>Project charter narrative fields (goals, scope, business case, …)</li>
              <li>Project team members / stakeholders (by email)</li>
              <li>Task assignments (by email)</li>
              <li>Risks and Blockers on project / phase / task</li>
              <li>Dated execution / progress updates</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">What is not imported yet</h3>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>Governance tab data</li>
              <li>Dependencies, Gantt-only data</li>
              <li>KPI definitions and KPI snapshots</li>
              <li>Files / attachments</li>
              <li>Reporting snapshots and derived totals</li>
              <li>PowerPoint / Excel / PDF parsing and AI extraction</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Process guidance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to import</CardTitle>
          <CardDescription>
            Follow the steps below. Nothing is written to canonical PM tables until you
            explicitly commit.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">1 — Prepare</h4>
            <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-1">
              <li>Download a template</li>
              <li>Fill in your JSON (no comments — pure JSON)</li>
              <li>Select the target workspace</li>
              <li>Run <em>Validate structure</em> for client checks</li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">2 — Server dry-run</h4>
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
              <li>Does not import records</li>
              <li>Verifies permissions, workspace access, users, dates, references, duplicates, existing project conflicts</li>
              <li>Stores only a safe summary metadata row in the import audit table</li>
              <li>Fix any blocking errors, then re-run</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">3 — Commit &amp; verify</h4>
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
              <li>Commit creates canonical BTPM records</li>
              <li>All-or-nothing transaction</li>
              <li>A dry-run batch can be committed only once</li>
              <li>Raw JSON is never persisted</li>
              <li>Verify in Projects / Planning / Risks / Blockers / Updates</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template library</CardTitle>
          <CardDescription>
            Start from a template that matches the object families you need. Every template
            is valid <code className="text-xs">btpm_import_v1</code> JSON with example rows.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="flex items-start justify-between gap-3 border border-border rounded-md p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{t.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownload(t.id)}
                className="shrink-0"
              >
                <Download className="h-3.5 w-3.5 mr-1" /> JSON
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Target workspace + upload/paste */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target workspace &amp; payload</CardTitle>
          <CardDescription>
            Server dry-run validates the payload against real database state in the selected
            workspace. Nothing is written to canonical PM tables in this step.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,320px)_1fr] items-center">
            <label className="text-sm font-medium text-foreground">Target workspace</label>
            <Select value={workspaceId} onValueChange={(v) => { setWorkspaceId(v); clearDownstream(); }}>
              <SelectTrigger className="w-full md:max-w-md">
                <SelectValue
                  placeholder={
                    workspacesQ.isLoading
                      ? "Loading workspaces…"
                      : "Select a workspace"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Upload JSON file
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  setRawText(text);
                  setFileName(null);
                  setResult(null);
                  clearDownstream();
                } catch {
                  toast({
                    title: "Clipboard blocked",
                    description: "Paste into the box instead.",
                  });
                }
              }}
            >
              <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste from clipboard
            </Button>
            {fileName && (
              <span className="text-xs text-muted-foreground">Loaded file: {fileName}</span>
            )}
          </div>

          <Textarea
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              setResult(null);
              clearDownstream();
            }}
            placeholder='Paste btpm_import_v1 JSON here…'
            className="font-mono text-xs min-h-[220px]"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleValidate} disabled={!canValidate}>
              Validate structure
            </Button>
            <Button
              variant="secondary"
              onClick={handleServerDryRun}
              disabled={!canServerDryRun}
              title={
                !workspaceId
                  ? "Select a target workspace first"
                  : !result?.ok
                  ? "Run client validation first"
                  : ""
              }
            >
              <ServerCog className="h-3.5 w-3.5 mr-1" />
              {serverBusy ? "Running server dry-run…" : "Server dry-run"}
            </Button>
            <Button
              variant="default"
              onClick={handleCommit}
              disabled={!canCommit}
              title={
                !serverResult?.ok
                  ? "Run a successful server dry-run first"
                  : dryRunSnapshot?.payloadJson !== currentPayloadJson
                  ? "Payload changed since dry-run — re-run dry-run"
                  : dryRunSnapshot?.workspaceId !== workspaceId
                  ? "Workspace changed since dry-run — re-run dry-run"
                  : commitResult?.ok
                  ? "This dry-run batch has already been committed"
                  : ""
              }
            >
              <Lock className="h-3.5 w-3.5 mr-1" />
              {commitBusy ? "Committing…" : "Commit import"}
            </Button>
          </div>



          {hasScopedOutRows && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Risks, blockers, and progress updates included</AlertTitle>
              <AlertDescription className="text-xs">
                Risks ({scopedOutCounts.risks}), blockers ({scopedOutCounts.blockers}), and
                execution updates ({scopedOutCounts.execution_updates}) will be committed
                from validated JSON into canonical BTPM records alongside the core planning
                structure.
              </AlertDescription>
            </Alert>
          )}

          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Client structure validation only</AlertTitle>
            <AlertDescription className="text-xs">
              Client checks do not verify database permissions, workspace access, existing
              users, existing records, or encrypted backend commit safety. Use Server
              dry-run for that.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Client validation results */}
      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {result.ok ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              <CardTitle className="text-base">
                Client validation:{" "}
                {result.ok ? "structure valid" : "errors found"}
              </CardTitle>
            </div>
            <CardDescription>
              {result.ok
                ? `Payload parsed with ${totalRows} row(s) across ${
                    counts ? Object.values(counts).filter((n) => n > 0).length : 0
                  } object families.`
                : `${result.errors.length} error(s), ${result.warnings.length} warning(s).`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {counts && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {OBJECT_FAMILIES.map((f) => (
                  <div
                    key={f}
                    className="flex items-center justify-between border border-border rounded-md px-3 py-2"
                  >
                    <span className="text-xs text-muted-foreground">
                      {FAMILY_LABELS[f]}
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {counts[f]}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <IssueList title="Errors" color="destructive" issues={result.errors} />
            <IssueList title="Warnings" color="amber" issues={result.warnings} />
          </CardContent>
        </Card>
      )}

      {/* Server dry-run results */}
      {(serverResult || serverError) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {serverResult?.ok ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              <CardTitle className="text-base">
                Server dry-run:{" "}
                {serverError
                  ? "request failed"
                  : serverResult?.ok
                  ? "passed"
                  : "errors found"}
              </CardTitle>
            </div>
            <CardDescription>
              {serverError
                ? serverError
                : serverResult?.ok
                ? "Dry-run passed. No data has been imported yet."
                : `${serverResult?.errors.length ?? 0} error(s), ${
                    serverResult?.warnings.length ?? 0
                  } warning(s), ${serverResult?.defaults.length ?? 0} default(s).`}
            </CardDescription>
          </CardHeader>
          {serverResult && (
            <CardContent className="space-y-4">
              <div className="text-xs text-muted-foreground">
                Workspace: <span className="font-medium text-foreground">
                  {serverResult.summary.workspace_name ?? serverResult.summary.workspace_id}
                </span>
                {serverResult.batch_id && (
                  <>
                    {" · "}
                    Batch:{" "}
                    <code className="font-mono">{serverResult.batch_id}</code>
                  </>
                )}
              </div>

              {serverResult.summary.plan && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Create / reuse plan</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {Object.entries(serverResult.summary.plan).map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-center justify-between border border-border rounded-md px-3 py-2"
                      >
                        <span className="text-xs text-muted-foreground">
                          {k.replace(/_/g, " ")}
                        </span>
                        <span className="text-sm font-semibold text-foreground">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <IssueList title="Errors" color="destructive" issues={serverResult.errors} />
              <IssueList title="Warnings" color="amber" issues={serverResult.warnings} />
              <IssueList title="Defaults that will be applied" color="blue" issues={serverResult.defaults} />

              {serverResult.ok && !commitResult?.ok && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Ready to commit</AlertTitle>
                  <AlertDescription className="text-xs">
                    Dry-run wrote a safe summary row to the import batch audit table — no
                    PM records were created yet. Click <strong>Commit import</strong> above
                    to persist programs, projects, phases, tasks, team, assignments, risks,
                    blockers, and progress updates transactionally.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {(commitResult || commitError) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {commitResult?.ok ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              <CardTitle className="text-base">
                Commit:{" "}
                {commitError
                  ? "request failed"
                  : commitResult?.ok
                  ? "import committed successfully"
                  : "commit failed"}
              </CardTitle>
            </div>
            <CardDescription>
              {commitError
                ? commitError
                : commitResult?.ok
                ? "Programs, projects, phases, tasks, team, assignments, risks, blockers, and progress updates were created transactionally. Open Projects to verify."
                : (commitResult?.message ??
                    "No records were committed. See errors below.")}
            </CardDescription>
          </CardHeader>
          {commitResult && (
            <CardContent className="space-y-4">
              {commitResult.summary && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(commitResult.summary).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between border border-border rounded-md px-3 py-2"
                    >
                      <span className="text-xs text-muted-foreground">
                        {k.replace(/_/g, " ")}
                      </span>
                      <span className="text-sm font-semibold text-foreground">
                        {v ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {commitResult.errors && commitResult.errors.length > 0 && (
                <IssueList title="Errors" color="destructive" issues={commitResult.errors} />
              )}
              {commitResult.warnings && commitResult.warnings.length > 0 && (
                <IssueList title="Warnings" color="amber" issues={commitResult.warnings} />
              )}
              {commitResult.ok && (
                <>
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Import committed</AlertTitle>
                    <AlertDescription className="text-xs">
                      This dry-run batch cannot be re-committed. To import more data,
                      generate a new payload and run dry-run again.
                    </AlertDescription>
                  </Alert>
                  <div className="border border-border rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-primary" />
                      <h4 className="text-sm font-semibold text-foreground">
                        Post-commit verification checklist
                        {committedWorkspaceName ? ` — ${committedWorkspaceName}` : ""}
                      </h4>
                    </div>
                    <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
                      <li>Open <strong>Projects</strong> in the selected workspace and confirm the imported project exists.</li>
                      <li>Open <strong>Planning / Gantt</strong> and confirm phases and tasks with their dates.</li>
                      <li>Open <strong>Team / Stakeholders</strong> and confirm imported members.</li>
                      <li>Open the task assignment surface and confirm assignees by email.</li>
                      <li>Open <strong>Risks</strong> and <strong>Blockers</strong> and confirm imported control items.</li>
                      <li>Open the execution / progress update surface and confirm imported dated updates.</li>
                    </ul>
                    <div className="pt-1">
                      <Button size="sm" variant="outline" asChild>
                        <a href="/projects">Open Projects</a>
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Import History */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Import history</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Recent dry-run and commit batches for this organization. Shows safe metadata
                only — no imported content, descriptions, summaries or PII.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => historyQ.refetch()}
              disabled={historyQ.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${historyQ.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {historyQ.isLoading ? (
            <div className="text-xs text-muted-foreground">Loading history…</div>
          ) : historyQ.error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not load history</AlertTitle>
              <AlertDescription className="text-xs">
                {(historyQ.error as Error).message}
              </AlertDescription>
            </Alert>
          ) : (historyQ.data ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No import batches yet. Run a server dry-run to create your first entry.
            </div>
          ) : (
            <div className="space-y-2">
              {(historyQ.data ?? []).map((b) => {
                const expanded = !!expandedBatchIds[b.id];
                const shortHash = b.payload_hash ? b.payload_hash.slice(0, 12) : "—";
                const statusColor =
                  b.status === "committed"
                    ? "default"
                    : b.status === "dry_run_ok"
                    ? "secondary"
                    : b.status === "dry_run_failed" || b.status === "commit_failed"
                    ? "destructive"
                    : "outline";
                const counts = b.counts_json ?? {};
                return (
                  <div key={b.id} className="border border-border rounded-md">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-accent/40"
                      onClick={() =>
                        setExpandedBatchIds((s) => ({ ...s, [b.id]: !s[b.id] }))
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {b.workspace_name ?? b.workspace_id}
                            </span>
                            <Badge variant={statusColor as any}>{b.status}</Badge>
                            <code className="text-[11px] font-mono text-muted-foreground">
                              #{shortHash}
                            </code>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {new Date(b.created_at).toLocaleString()}
                            {b.requested_by_display_name
                              ? ` · ${b.requested_by_display_name}`
                              : ""}
                            {b.source_name ? ` · ${b.source_name}` : ""}
                            {b.source_file_name ? ` · ${b.source_file_name}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground shrink-0">
                        {Object.values(counts).reduce(
                          (a, v) => a + (typeof v === "number" ? v : 0),
                          0,
                        )}{" "}
                        rows
                      </div>
                    </button>
                    {expanded && (
                      <div className="border-t border-border p-3 space-y-3 bg-muted/20">
                        <div className="grid gap-2 md:grid-cols-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Batch id:</span>{" "}
                            <code className="font-mono">{b.id}</code>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Payload hash:</span>{" "}
                            <code className="font-mono">{b.payload_hash ?? "—"}</code>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Schema:</span>{" "}
                            {b.schema_version} / {b.import_type}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Requested by:</span>{" "}
                            {b.requested_by_email ?? b.requested_by ?? "—"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Created:</span>{" "}
                            {new Date(b.created_at).toLocaleString()}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Dry-run:</span>{" "}
                            {b.dry_run_at ? new Date(b.dry_run_at).toLocaleString() : "—"}
                          </div>
                          <div>
                            <span className="text-muted-foreground">Committed:</span>{" "}
                            {b.committed_at ? new Date(b.committed_at).toLocaleString() : "—"}
                          </div>
                        </div>

                        {Object.keys(counts).length > 0 && (
                          <div>
                            <h5 className="text-xs font-semibold mb-1">Counts</h5>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                              {Object.entries(counts).map(([k, v]) => (
                                <div
                                  key={k}
                                  className="flex items-center justify-between text-[11px] border border-border rounded px-2 py-1 bg-background"
                                >
                                  <span className="text-muted-foreground">
                                    {k.replace(/_/g, " ")}
                                  </span>
                                  <span className="font-semibold">
                                    {typeof v === "number" ? v : 0}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {b.safe_summary_json && Object.keys(b.safe_summary_json).length > 0 && (
                          <div>
                            <h5 className="text-xs font-semibold mb-1">Plan / summary</h5>
                            <pre className="text-[11px] font-mono bg-background border border-border rounded p-2 overflow-x-auto">
                              {JSON.stringify(b.safe_summary_json, null, 2)}
                            </pre>
                          </div>
                        )}

                        {b.safe_issue_summary_json &&
                          Object.keys(b.safe_issue_summary_json).length > 0 && (
                            <div>
                              <h5 className="text-xs font-semibold mb-1">Issue summary</h5>
                              <pre className="text-[11px] font-mono bg-background border border-border rounded p-2 overflow-x-auto">
                                {JSON.stringify(b.safe_issue_summary_json, null, 2)}
                              </pre>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
