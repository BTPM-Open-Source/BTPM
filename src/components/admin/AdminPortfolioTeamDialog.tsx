import { useMemo, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useAdminUsers } from "@/hooks/useAdminUsers";
import type { AdminPortfolioItem } from "@/hooks/useAdminPortfolioItems";
import {
  PORTFOLIO_TEAM_ROLES,
  portfolioTeamRoleLabel,
  useAdminPortfolioTeam,
  useAdminPortfolioTeamMutations,
  type PortfolioTeamRole,
} from "@/hooks/useAdminPortfolioTeam";

interface Props {
  item: AdminPortfolioItem | null;
  organizationId: string;
  onClose: () => void;
}

export default function AdminPortfolioTeamDialog({ item, organizationId, onClose }: Props) {
  const portfolioId = item?.id ?? null;
  const { data: users } = useAdminUsers(organizationId);
  const { data: team, isLoading, error } = useAdminPortfolioTeam(portfolioId);
  const { addMember, updateRole, removeMember } = useAdminPortfolioTeamMutations(
    portfolioId,
    organizationId,
  );

  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<PortfolioTeamRole>("product_manager");

  const activeUserOptions = useMemo(() => {
    return (users ?? [])
      .filter(
        (u) => u.row_kind === "active_user" && !!u.user_id && u.status === "active",
      )
      .map((u) => ({
        id: u.user_id as string,
        label: u.display_name?.trim() || u.email,
        email: u.email,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const handleAdd = async () => {
    if (!selectedUser) return;
    try {
      await addMember.mutateAsync({ user_id: selectedUser, role: selectedRole });
      setSelectedUser("");
    } catch {
      /* toast surfaced */
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setSelectedUser("");
      setSelectedRole("product_manager");
      onClose();
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{item?.name ?? "Portfolio"} — Team</DialogTitle>
          <DialogDescription>
            Portfolio Team is a controlled accountability list. It does not change
            project membership; linked projects continue to derive from project
            Portfolio assignment.
          </DialogDescription>
        </DialogHeader>

        {/* Add-member form */}
        <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
          <p className="text-sm font-medium text-foreground">Add team member</p>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">User</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an active user…" />
                </SelectTrigger>
                <SelectContent>
                  {activeUserOptions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No active users available.
                    </div>
                  ) : (
                    activeUserOptions.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.label} <span className="text-muted-foreground">— {u.email}</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as PortfolioTeamRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORTFOLIO_TEAM_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {portfolioTeamRoleLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleAdd}
              disabled={!selectedUser || addMember.isPending}
              size="sm"
            >
              <UserPlus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>

        {/* Members list */}
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">
            Failed to load team: {(error as Error).message}
          </p>
        ) : !team || team.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground border rounded-lg">
            No Portfolio team members assigned yet.
          </p>
        ) : (
          <div className="border rounded-lg max-h-[50vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-[220px]">Role</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.map((m) => (
                  <TableRow key={m.team_member_id}>
                    <TableCell className="font-medium">
                      {m.display_name?.trim() || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.email}</TableCell>
                    <TableCell>
                      <Select
                        value={m.role}
                        onValueChange={(v) =>
                          updateRole.mutate({
                            team_member_id: m.team_member_id,
                            role: v as PortfolioTeamRole,
                          })
                        }
                        disabled={updateRole.isPending}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PORTFOLIO_TEAM_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {portfolioTeamRoleLabel(r)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeMember.mutate(m.team_member_id)}
                        disabled={removeMember.isPending}
                        title="Remove team member"
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
      </DialogContent>
    </Dialog>
  );
}
