import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Trash2, Plus, Search, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  usePortfolioItemProjectMembership,
  type AdminPortfolioItem,
} from "@/hooks/useAdminPortfolioItems";
import {
  usePortfolioProjectAssignmentCandidates,
  useAssignProjectsToPortfolio,
  useRemoveProjectsFromPortfolio,
  type PortfolioAssignmentCandidate,
} from "@/hooks/useAdminPortfolioProjectAssignments";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function useOrgWorkspaces(organizationId: string) {
  return useQuery({
    queryKey: ["admin-portfolio-manage-workspaces", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

export default function AdminPortfolioManageProjectsDialog({
  item,
  organizationId,
  onClose,
}: {
  item: AdminPortfolioItem | null;
  organizationId: string;
  onClose: () => void;
}) {
  const portfolioId = item?.id ?? null;
  const [assignOpen, setAssignOpen] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmReassign, setConfirmReassign] = useState<{
    projects: PortfolioAssignmentCandidate[];
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  const linked = usePortfolioItemProjectMembership(portfolioId, true);
  const workspaces = useOrgWorkspaces(organizationId);

  const candidates = usePortfolioProjectAssignmentCandidates({
    portfolioItemId: portfolioId,
    workspaceIds: workspaceFilter === "all" ? null : [workspaceFilter],
    search,
    includeArchived: false,
    enabled: assignOpen,
  });

  const assignMut = useAssignProjectsToPortfolio(portfolioId);
  const removeMut = useRemoveProjectsFromPortfolio(portfolioId);

  const candidateList = candidates.data ?? [];
  const allSelected =
    candidateList.length > 0 && candidateList.every((c) => selected.has(c.project_id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearAssignState = () => {
    setSelected(new Set());
    setSearch("");
    setWorkspaceFilter("all");
  };

  const handleClose = () => {
    setAssignOpen(false);
    clearAssignState();
    onClose();
  };

  const doAssign = async (ids: string[]) => {
    await assignMut.mutateAsync(ids);
    setSelected(new Set());
    setConfirmReassign(null);
  };

  const handleAssignClick = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const chosen = candidateList.filter((c) => selected.has(c.project_id));
    const reassigning = chosen.filter((c) => c.assignment_state === "assigned_to_other");
    if (reassigning.length > 0) {
      setConfirmReassign({ projects: reassigning });
    } else {
      doAssign(ids);
    }
  };

  const linkedProjects = useMemo(() => linked.data ?? [], [linked.data]);

  return (
    <>
      <Dialog open={!!item} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{item?.name ?? "Portfolio"} — Manage linked projects</DialogTitle>
            <DialogDescription>
              Projects are derived from their current Portfolio assignment. Membership is not stored.
            </DialogDescription>
          </DialogHeader>

          {/* Linked projects */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Linked projects</h3>
              <Button
                size="sm"
                variant={assignOpen ? "secondary" : "default"}
                onClick={() => setAssignOpen((v) => !v)}
              >
                <Plus className="h-4 w-4 mr-1" />
                {assignOpen ? "Hide assign panel" : "Assign projects"}
              </Button>
            </div>

            {linked.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : linked.error ? (
              <p className="text-sm text-destructive">
                Failed to load: {(linked.error as Error).message}
              </p>
            ) : linkedProjects.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground border rounded">
                No projects are currently assigned to this Portfolio.
              </p>
            ) : (
              <div className="border rounded-lg max-h-[40vh] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Program</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>Target end</TableHead>
                      <TableHead>Archived</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedProjects.map((p) => (
                      <TableRow key={p.project_id}>
                        <TableCell className="font-medium">
                          <Link
                            to={`/workspace/${p.workspace_id}/project/${p.project_id}`}
                            className="hover:underline inline-flex items-center gap-1"
                          >
                            {p.project_name}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </TableCell>
                        <TableCell>{p.workspace_name}</TableCell>
                        <TableCell>{p.program_name ?? "—"}</TableCell>
                        <TableCell>{p.status ?? "—"}</TableCell>
                        <TableCell>{p.priority ?? "—"}</TableCell>
                        <TableCell>{p.project_stage ?? "—"}</TableCell>
                        <TableCell>{p.delivery_model ?? "—"}</TableCell>
                        <TableCell>{formatDate(p.start_date)}</TableCell>
                        <TableCell>{formatDate(p.target_end_date)}</TableCell>
                        <TableCell>
                          {p.is_archived ? <Badge variant="secondary">Archived</Badge> : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setRemoveTarget({ id: p.project_id, name: p.project_name })
                            }
                            title="Remove from Portfolio"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Assign panel */}
          {assignOpen && (
            <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Assign projects</h3>
                <div className="text-xs text-muted-foreground">
                  {selected.size} selected
                </div>
              </div>

              <div className="flex flex-wrap gap-2 items-end">
                <div className="w-[220px]">
                  <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
                    <SelectTrigger><SelectValue placeholder="Workspace" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All workspaces</SelectItem>
                      {(workspaces.data ?? []).map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[200px] relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search project name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={selected.size === 0 || assignMut.isPending}
                  onClick={handleAssignClick}
                >
                  {assignMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Assign selected
                </Button>
              </div>

              <div className="border rounded max-h-[40vh] overflow-auto bg-background">
                {candidates.isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : candidates.error ? (
                  <p className="p-4 text-sm text-destructive">
                    Failed to load candidates: {(candidates.error as Error).message}
                  </p>
                ) : candidateList.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    No available projects found.
                  </p>
                ) : (
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={(v) => {
                              if (v) setSelected(new Set(candidateList.map((c) => c.project_id)));
                              else setSelected(new Set());
                            }}
                          />
                        </TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Workspace</TableHead>
                        <TableHead>Program</TableHead>
                        <TableHead>Current Portfolio</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priority</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidateList.map((c) => (
                        <TableRow key={c.project_id}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(c.project_id)}
                              onCheckedChange={() => toggle(c.project_id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{c.project_name}</TableCell>
                          <TableCell>{c.workspace_name}</TableCell>
                          <TableCell>{c.program_name ?? "—"}</TableCell>
                          <TableCell>
                            {c.assignment_state === "unassigned" ? (
                              <Badge variant="outline">Unassigned</Badge>
                            ) : (
                              <Badge variant="secondary" title="Assigning here will move it">
                                Assigned to: {c.current_portfolio_name ?? "—"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{c.status ?? "—"}</TableCell>
                          <TableCell>{c.priority ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reassignment confirmation */}
      <AlertDialog
        open={!!confirmReassign}
        onOpenChange={(o) => { if (!o) setConfirmReassign(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move projects to this Portfolio?</AlertDialogTitle>
            <AlertDialogDescription>
              Some selected projects are already assigned to another Portfolio.
              Assigning them here will move them to this Portfolio.
              {confirmReassign && (
                <ul className="mt-3 list-disc pl-5 text-xs">
                  {confirmReassign.projects.map((p) => (
                    <li key={p.project_id}>
                      <span className="font-medium">{p.project_name}</span>
                      {" — currently in "}
                      {p.current_portfolio_name ?? "another Portfolio"}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => doAssign(Array.from(selected))}
            >
              Move and assign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove confirmation */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove project from Portfolio?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unassign <span className="font-medium">{removeTarget?.name}</span> from
              this Portfolio. The project itself is not archived or modified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!removeTarget) return;
                await removeMut.mutateAsync([removeTarget.id]);
                setRemoveTarget(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
