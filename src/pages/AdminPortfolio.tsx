import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, Pencil, Archive, ArchiveRestore, Users2, Layers, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useAdminUsers } from "@/hooks/useAdminUsers";
import {
  useAdminPortfolioItems,
  useAdminPortfolioMutations,
  type AdminPortfolioItem,
  PORTFOLIO_LIFECYCLE_STATES,
  PORTFOLIO_STRATEGIC_PRIORITIES,
  portfolioLifecycleLabel,
  portfolioStrategicPriorityLabel,
  type PortfolioLifecycleState,
  type PortfolioStrategicPriority,
} from "@/hooks/useAdminPortfolioItems";
import AdminPortfolioItemDialog from "@/components/admin/AdminPortfolioItemDialog";
import AdminPortfolioTeamDialog from "@/components/admin/AdminPortfolioTeamDialog";
import AdminPortfolioManageProjectsDialog from "@/components/admin/AdminPortfolioManageProjectsDialog";

type ArchivedFilter = "active" | "archived" | "all";

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

// MembershipDialog was replaced by AdminPortfolioManageProjectsDialog (Phase 6E.2).

export default function AdminPortfolio() {
  const { organizationId } = useOutletContext<{ organizationId: string }>();
  const [archivedFilter, setArchivedFilter] = useState<ArchivedFilter>("active");
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | PortfolioLifecycleState>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | PortfolioStrategicPriority>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPortfolioItem | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<AdminPortfolioItem | null>(null);
  const [membershipItem, setMembershipItem] = useState<AdminPortfolioItem | null>(null);
  const [teamItem, setTeamItem] = useState<AdminPortfolioItem | null>(null);

  const includeArchivedFromRpc = archivedFilter !== "active";
  const { data: items, isLoading, error } = useAdminPortfolioItems(
    organizationId,
    includeArchivedFromRpc,
  );
  const { data: users } = useAdminUsers(organizationId);
  const mutations = useAdminPortfolioMutations(organizationId);

  const ownerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    (users ?? []).forEach((u) => {
      if (u.user_id) map.set(u.user_id, u.display_name?.trim() || u.email);
    });
    return map;
  }, [users]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((i) => {
      if (archivedFilter === "archived" && !i.is_archived) return false;
      if (archivedFilter === "active" && i.is_archived) return false;
      if (lifecycleFilter !== "all" && i.lifecycle_state !== lifecycleFilter) return false;
      if (priorityFilter !== "all" && i.strategic_priority !== priorityFilter) return false;
      if (q) {
        const hay = `${i.name} ${i.code ?? ""} ${i.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, archivedFilter, lifecycleFilter, priorityFilter]);

  const metrics = useMemo(() => {
    const visible = filtered;
    const totalProjects = visible.reduce((n, i) => n + (i.project_count || 0), 0);
    const activeProjects = visible.reduce((n, i) => n + (i.active_project_count || 0), 0);
    const workspaces = visible.reduce((n, i) => n + (i.workspace_count || 0), 0);
    return {
      visible: visible.length,
      totalProjects,
      activeProjects,
      workspaces,
    };
  }, [filtered]);

  const handleNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const handleEdit = (item: AdminPortfolioItem) => {
    setEditing(item);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Portfolio</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Portfolio is an organization-level grouping used to connect projects
            across workspaces. Programs remain workspace-level groupings.
          </p>
        </div>
        <Button size="sm" onClick={handleNew}>
          <Plus className="h-4 w-4 mr-1" /> New Portfolio
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Portfolios shown" value={metrics.visible} />
        <MetricCard label="Linked projects" value={metrics.totalProjects} />
        <MetricCard label="Active linked projects" value={metrics.activeProjects} />
        <MetricCard label="Workspaces represented" value={metrics.workspaces} />
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="min-w-[220px] flex-1">
          <Input
            placeholder="Search name, code, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-[180px]">
          <Select value={lifecycleFilter} onValueChange={(v) => setLifecycleFilter(v as typeof lifecycleFilter)}>
            <SelectTrigger><SelectValue placeholder="Lifecycle stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lifecycle stages</SelectItem>
              {PORTFOLIO_LIFECYCLE_STATES.map((s) => (
                <SelectItem key={s} value={s}>{portfolioLifecycleLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[180px]">
          <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as typeof priorityFilter)}>
            <SelectTrigger><SelectValue placeholder="Strategic priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {PORTFOLIO_STRATEGIC_PRIORITIES.map((s) => (
                <SelectItem key={s} value={s}>{portfolioStrategicPriorityLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[160px]">
          <Select value={archivedFilter} onValueChange={(v) => setArchivedFilter(v as ArchivedFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="archived">Archived only</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <p className="py-6 text-sm text-destructive">
          Failed to load Portfolio items: {(error as Error).message}
        </p>
      ) : !items || items.length === 0 ? (
        <div className="flex flex-col items-center py-16 space-y-3 border rounded-lg">
          <Layers className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-md text-center">
            No Portfolio items yet. Portfolios let you group projects across
            workspaces for company-wide visibility.
          </p>
          <Button size="sm" onClick={handleNew}>
            <Plus className="h-4 w-4 mr-1" /> New Portfolio
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground border rounded-lg">
          No Portfolio items match the current filters.
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Lifecycle stage</TableHead>
                <TableHead>Strategic priority</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Projects</TableHead>
                <TableHead>Workspaces</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right w-[260px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const ownerLabel = item.owner_id
                  ? ownerLabelById.get(item.owner_id) ?? "—"
                  : "—";
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        {item.name}
                        {item.is_archived && (
                          <Badge variant="secondary" className="font-normal">Archived</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.code ?? "—"}</TableCell>
                    <TableCell>{portfolioLifecycleLabel(item.lifecycle_state)}</TableCell>
                    <TableCell>{portfolioStrategicPriorityLabel(item.strategic_priority)}</TableCell>
                    <TableCell>{ownerLabel}</TableCell>
                    <TableCell>
                      <span>{item.active_project_count}</span>
                      {item.project_count !== item.active_project_count && (
                        <span className="text-muted-foreground"> / {item.project_count}</span>
                      )}
                    </TableCell>
                    <TableCell>{item.workspace_count}</TableCell>
                    <TableCell>{item.active_team_member_count ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(item.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setMembershipItem(item)}
                          title="Manage linked projects"
                          disabled={item.is_archived}
                        >
                          <Users2 className="h-4 w-4 mr-1" /> Projects
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setTeamItem(item)}
                          title="Manage Portfolio team"
                        >
                          <UsersRound className="h-4 w-4 mr-1" /> Team
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEdit(item)}
                          title="Edit Portfolio"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {item.is_archived ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => mutations.unarchivePortfolioItem.mutate(item.id)}
                            disabled={mutations.unarchivePortfolioItem.isPending}
                            title="Unarchive Portfolio"
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmArchive(item)}
                            title="Archive Portfolio"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminPortfolioItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
        item={editing}
      />

      <AdminPortfolioManageProjectsDialog
        item={membershipItem}
        organizationId={organizationId}
        onClose={() => setMembershipItem(null)}
      />

      <AdminPortfolioTeamDialog
        item={teamItem}
        organizationId={organizationId}
        onClose={() => setTeamItem(null)}
      />

      <AlertDialog
        open={!!confirmArchive}
        onOpenChange={(o) => { if (!o) setConfirmArchive(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Portfolio</AlertDialogTitle>
            <AlertDialogDescription>
              Archiving hides this Portfolio from future project assignment.
              Existing assigned projects remain linked for historical context, and
              no project records are deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmArchive) {
                  mutations.archivePortfolioItem.mutate(confirmArchive.id);
                  setConfirmArchive(null);
                }
              }}
            >
              Archive Portfolio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
