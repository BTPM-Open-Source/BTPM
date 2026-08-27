import { useParams } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useWorkspaceMembersList,
  useCanManageWorkspace,
  useWorkspaceMemberMutations,
} from "@/hooks/useWorkspaceMembersAdmin";
import { useWorkspaceAccessHistory } from "@/hooks/useAccessHistory";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, Trash2, ShieldAlert, Eye } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import WsAddMemberDialog from "@/components/workspace/WsAddMemberDialog";
import { AccessHistorySection } from "@/components/admin/AccessHistorySection";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_CONCEPTS } from "@/components/knowledge/kc-concepts";
import { useWorkspaceProjectAccessCounts } from "@/hooks/useProjectAccessAdmin";
import { Link } from "react-router-dom";
import { useIsOrgAdmin } from "@/hooks/useIsOrgAdmin";

const WORKSPACE_ROLES = [
  { value: "workspace_admin", label: "Workspace Admin" },
  { value: "project_manager", label: "Project Manager" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" },
];

export default function WorkspaceMembers({ workspaceId: workspaceIdProp }: { workspaceId?: string } = {}) {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = workspaceIdProp ?? params.workspaceId;
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { data: members, isLoading } = useWorkspaceMembersList(workspaceId);
  const { data: canManage } = useCanManageWorkspace(workspaceId);
  const mutations = useWorkspaceMemberMutations(workspaceId);
  const { data: orgAdminInfo } = useIsOrgAdmin();
  const { data: accessCounts } = useWorkspaceProjectAccessCounts(workspaceId, !!canManage);
  const countsByUser: Record<string, { accessible: number; total: number }> = {};
  (accessCounts || []).forEach((r) => {
    countsByUser[r.user_id] = { accessible: r.accessible_count, total: r.total_active_projects };
  });

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  // Get workspace org_id for add-member dialog and access history
  const { data: workspace } = useQuery({
    queryKey: ["workspace-decrypted", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_decrypted_workspace", { _workspace_id: workspaceId! });
      if (error) throw error;
      return data as any;
    },
    enabled: !!workspaceId,
  });

  const { data: accessHistory = [], isLoading: historyLoading } = useWorkspaceAccessHistory(
    workspace?.organization_id,
    workspaceId
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const existingUserIds = members?.map((m) => m.user_id) || [];

  // Build actor name map for history
  const actorNames: Record<string, string> = {};
  if (currentUser?.id) actorNames[currentUser.id] = "You";
  members?.forEach((m) => {
    if (m.user_id && m.display_name) actorNames[m.user_id] = m.display_name;
  });

  const handleRoleChange = (userId: string, newRole: string) => {
    mutations.changeRole.mutate(
      { userId, newRole },
      {
        onError: (err: any) => {
          toast({
            title: "Cannot change role",
            description: err.message?.includes("last workspace admin")
              ? "This user is the last Workspace Admin. Assign another Workspace Admin first."
              : err.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleRemoveMember = (userId: string) => {
    mutations.removeMember.mutate(
      { userId },
      {
        onError: (err: any) => {
          toast({
            title: "Cannot remove member",
            description: err.message?.includes("last workspace admin")
              ? "This user is the last Workspace Admin. Assign another Workspace Admin first."
              : err.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          Members
          <ConceptHelp
            term={KC_CONCEPTS.workspaceAccess.term}
            shortText={KC_CONCEPTS.workspaceAccess.shortText}
            articleSlug={KC_CONCEPTS.workspaceAccess.slug}
          />
        </h2>
        <div className="flex items-center gap-2">
          <KnowledgeLink slug="roles-and-permissions" label="Roles & permissions" />
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1" /> Add member
            </Button>
          )}
        </div>
      </div>

      {/* Read-only notice for non-admins */}
      {canManage === false && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
          <Eye className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Read-only view</p>
            <p className="text-xs">You can see workspace members but cannot manage them. Only Workspace Admins and Organization Admins can add, remove, or change member roles.</p>
          </div>
        </div>
      )}

      {!canManage && members && members.length === 0 && (
        <div className="flex flex-col items-center py-12 space-y-3">
          <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">You do not have permission to view workspace members.</p>
        </div>
      )}

      {members && members.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Workspace Role</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead>Project Access</TableHead>}
              {canManage && <TableHead className="w-[100px]">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.user_id}>
                <TableCell className="font-medium">{m.display_name || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{m.email || "—"}</TableCell>
                <TableCell>
                  {canManage ? (
                    <Select
                      value={m.workspace_role || "viewer"}
                      onValueChange={(val) => handleRoleChange(m.user_id, val)}
                    >
                      <SelectTrigger className="w-[160px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WORKSPACE_ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">
                      {WORKSPACE_ROLES.find((r) => r.value === m.workspace_role)?.label || m.workspace_role || "—"}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={m.is_active ? "default" : "destructive"}>
                    {m.is_active ? "Active" : "Deactivated"}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell>
                    {(() => {
                      const c = countsByUser[m.user_id];
                      const label = c ? `${c.accessible} / ${c.total}` : "—";
                      const orgId = orgAdminInfo?.organizationId;
                      return orgId ? (
                        <Link
                          to={`/admin/users/${m.user_id}`}
                          className="text-xs underline-offset-2 hover:underline text-foreground"
                        >
                          {label} <span className="text-muted-foreground">manage</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">{label}</span>
                      );
                    })()}
                  </TableCell>
                )}
                {canManage && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setRemoveTarget({ id: m.user_id, name: m.display_name || m.email || "this user" })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Access History */}
      {canManage && (
        <AccessHistorySection
          events={accessHistory}
          isLoading={historyLoading}
          actorNames={actorNames}
          title="Recent Membership Changes"
        />
      )}

      {/* Add member dialog */}
      {workspace && (
        <WsAddMemberDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          workspaceId={workspace.id}
          existingUserIds={existingUserIds}
          onSubmit={(userId, role) => {
            mutations.addMember.mutate({ userId, role }, { onSuccess: () => setAddOpen(false) });
          }}
          loading={mutations.addMember.isPending}
        />
      )}

      {/* Remove confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove workspace access</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{removeTarget?.name}</strong> from this workspace? Their comments and history will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removeTarget) {
                  handleRemoveMember(removeTarget.id);
                  setRemoveTarget(null);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
