/**
 * AI.4 — Decision Brief Instruction Template Foundation (admin UI).
 *
 * Manages versioned, BTPM-owned instruction templates for the future
 * Decision Case AI brief generation. This is foundation only — no
 * brief generation runs here, and no persistent OpenAI agent is
 * created. The active version will be consumed by AI.5+.
 */
import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, FileText, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  useActivateAiInstructionTemplate,
  useArchiveAiInstructionTemplate,
  useAiInstructionTemplates,
  useCreateAiInstructionTemplateVersion,
  type AiInstructionTemplateRow,
} from "@/hooks/useAiInstructionTemplates";

const FEATURE = "decision_case_brief" as const;

function formatDateTime(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge>Active</Badge>;
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    default:
      return <Badge variant="outline">Archived</Badge>;
  }
}

export function DecisionBriefInstructionTemplates() {
  const list = useAiInstructionTemplates(FEATURE);
  const createMut = useCreateAiInstructionTemplateVersion();
  const activateMut = useActivateAiInstructionTemplate(FEATURE);
  const archiveMut = useArchiveAiInstructionTemplate(FEATURE);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [instructionText, setInstructionText] = useState("");
  const [notes, setNotes] = useState("");

  const [viewing, setViewing] = useState<AiInstructionTemplateRow | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<AiInstructionTemplateRow | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<AiInstructionTemplateRow | null>(null);

  const rows = list.data ?? [];
  const active = useMemo(() => rows.find((r) => r.status === "active") ?? null, [rows]);

  function resetCreate() {
    setTitle("");
    setInstructionText("");
    setNotes("");
  }

  async function onCreate() {
    if (!title.trim() || !instructionText.trim()) {
      toast.error("Title and instruction text are required");
      return;
    }
    try {
      await createMut.mutateAsync({
        feature: FEATURE,
        title: title.trim(),
        instruction_text: instructionText,
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success("Draft version created");
      setCreateOpen(false);
      resetCreate();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create version");
    }
  }

  async function onActivate(row: AiInstructionTemplateRow) {
    try {
      await activateMut.mutateAsync(row.id);
      toast.success(`Version ${row.version} activated`);
      setConfirmActivate(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not activate version");
    }
  }

  async function onArchive(row: AiInstructionTemplateRow) {
    try {
      await archiveMut.mutateAsync(row.id);
      toast.success(`Version ${row.version} archived`);
      setConfirmArchive(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not archive version");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Decision Brief instruction templates</CardTitle>
              <Badge variant="outline" className="text-[10px]">Foundation</Badge>
            </div>
            <CardDescription>
              BTPM-owned, versioned instructions for future AI Decision Brief
              generation. Only one version can be active per organization.
              No brief generation runs from this screen — AI.5 and later
              steps will consume the active version.
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New draft version
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Governance note</AlertTitle>
          <AlertDescription>
            These instructions are stored inside BTPM and remain under your
            organization's control. BTPM does not create or rely on a
            persistent external assistant; the active version is supplied
            at request time when brief generation is later enabled.
          </AlertDescription>
        </Alert>

        <div className="rounded-md border p-3 text-sm">
          <div className="text-xs text-muted-foreground mb-1">Active version</div>
          {active ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">v{active.version}</span>
              <span className="truncate">{active.title}</span>
              <span className="text-xs text-muted-foreground">
                Activated {formatDateTime(active.activated_at)}
              </span>
            </div>
          ) : (
            <div className="text-muted-foreground">
              No active version yet. Create a draft and activate it.
            </div>
          )}
        </div>

        {list.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            No instruction template versions yet.
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">v{r.version}</span>
                    <span className="truncate font-medium" title={r.title}>{r.title}</span>
                    {statusBadge(r.status)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created {formatDateTime(r.created_at)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button variant="outline" size="sm" onClick={() => setViewing(r)}>
                    <FileText className="h-4 w-4 mr-1" /> View
                  </Button>
                  {r.status === "draft" && (
                    <Button size="sm" onClick={() => setConfirmActivate(r)}>
                      Activate
                    </Button>
                  )}
                  {r.status !== "archived" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmArchive(r)}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetCreate();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New instruction template version</DialogTitle>
            <DialogDescription>
              Creates a new draft version. Drafts do not affect runtime
              behavior until activated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="tpl-title">Title</Label>
              <Input
                id="tpl-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Decision Brief v1 — initial draft"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-instruction">Instruction text</Label>
              <Textarea
                id="tpl-instruction"
                value={instructionText}
                onChange={(e) => setInstructionText(e.target.value)}
                placeholder="System / assistant instructions used by future AI Decision Brief generation."
                className="min-h-[220px] font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-notes">Notes (optional)</Label>
              <Textarea
                id="tpl-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Change log or rationale for this version."
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={createMut.isPending}>
              {createMut.isPending ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {viewing ? `v${viewing.version} — ${viewing.title}` : ""}
            </DialogTitle>
            <DialogDescription>
              {viewing && (
                <span className="flex flex-wrap gap-3 text-xs">
                  <span>Status: {viewing.status}</span>
                  <span>Created {formatDateTime(viewing.created_at)}</span>
                  {viewing.activated_at && (
                    <span>Activated {formatDateTime(viewing.activated_at)}</span>
                  )}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Instruction text</div>
                <ScrollArea className="h-[40vh] rounded-md border bg-muted/30">
                  <pre className="p-3 text-xs whitespace-pre-wrap font-mono">
                    {viewing.instruction_text}
                  </pre>
                </ScrollArea>
              </div>
              {viewing.notes && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Notes</div>
                  <div className="rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                    {viewing.notes}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Activate confirm */}
      <AlertDialog
        open={!!confirmActivate}
        onOpenChange={(o) => !o && setConfirmActivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Activating v{confirmActivate?.version} will archive the
              currently active version (if any). Activation does not
              trigger any AI generation by itself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmActivate && onActivate(confirmActivate)}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive confirm */}
      <AlertDialog
        open={!!confirmArchive}
        onOpenChange={(o) => !o && setConfirmArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Archived versions are kept for history but cannot be
              re-activated. Create a new draft if you want to revise.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmArchive && onArchive(confirmArchive)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
