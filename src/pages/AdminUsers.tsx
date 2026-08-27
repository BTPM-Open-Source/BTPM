import { useState, useMemo } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useAdminUsers, type AdminUserRow } from "@/hooks/useAdminUsers";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Users } from "lucide-react";

function formatRole(role: string | null): string {
  if (!role) return "—";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusBadge({ status }: { status: string }) {
  if (status === "deactivated") return <Badge variant="destructive">Deactivated</Badge>;
  if (status === "invited") return <Badge variant="secondary">Invited</Badge>;
  return <Badge variant="default">Active</Badge>;
}

export default function AdminUsers() {
  const { organizationId } = useOutletContext<{ organizationId: string }>();
  const { data: users, isLoading, error } = useAdminUsers(organizationId);
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");

  // Derive unique workspace names for workspace filter
  const allWorkspaceNames = useMemo(() => {
    if (!users) return [];
    const names = new Set<string>();
    users.forEach((u) => u.workspace_names?.forEach((n) => names.add(n)));
    return Array.from(names).sort();
  }, [users]);

  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");

  // Derive unique org roles
  const allRoles = useMemo(() => {
    if (!users) return [];
    const roles = new Set<string>();
    users.forEach((u) => { if (u.org_role) roles.add(u.org_role); });
    return Array.from(roles).sort();
  }, [users]);

  const filtered = useMemo(() => {
    if (!users) return [];
    return users.filter((u) => {
      // Search
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = u.display_name?.toLowerCase().includes(q);
        const emailMatch = u.email?.toLowerCase().includes(q);
        if (!nameMatch && !emailMatch) return false;
      }
      // Status
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      // Role
      if (roleFilter !== "all" && u.org_role !== roleFilter) return false;
      // Kind
      if (kindFilter !== "all" && u.row_kind !== kindFilter) return false;
      // Workspace
      if (workspaceFilter !== "all") {
        if (!u.workspace_names?.includes(workspaceFilter)) return false;
      }
      return true;
    });
  }, [users, search, statusFilter, roleFilter, kindFilter, workspaceFilter]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load users: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Org Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {allRoles.map((r) => (
              <SelectItem key={r} value={r}>{formatRole(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allWorkspaceNames.length > 0 && (
          <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Workspace" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workspaces</SelectItem>
              {allWorkspaceNames.map((w) => (
                <SelectItem key={w} value={w}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="active_user">Active Users</SelectItem>
            <SelectItem value="pending_invitation">Pending Invites</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 space-y-3">
          <Users className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {users?.length === 0 ? "No users in this organization yet." : "No users match the current filters."}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Org Role</TableHead>
                <TableHead>Workspaces</TableHead>
                <TableHead>Invitation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row, i) => (
                <TableRow
                  key={row.user_id || `inv-${row.email}-${i}`}
                  className={row.user_id ? "cursor-pointer hover:bg-muted/50" : ""}
                  onClick={() => row.user_id && navigate(`/admin/users/${row.user_id}`)}
                >
                  <TableCell className="font-medium">
                    {row.display_name || <span className="text-muted-foreground italic">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.email}</TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell>{formatRole(row.org_role)}</TableCell>
                  <TableCell>
                    {row.workspace_count > 0 ? (
                      <span className="text-sm">
                        {row.workspace_names?.join(", ") || `${row.workspace_count} workspace(s)`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.invitation_state ? (
                      <Badge variant="outline" className="text-xs capitalize">
                        {row.invitation_state}
                        {row.invitation_workspace_name ? ` → ${row.invitation_workspace_name}` : ""}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {users?.length || 0} total
      </p>
    </div>
  );
}
