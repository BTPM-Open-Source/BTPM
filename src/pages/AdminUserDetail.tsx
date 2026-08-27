import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useOutletContext } from "react-router-dom";
import { useAdminUserDetail, useAdminUserMutations } from "@/hooks/useAdminUserDetail";
import { useAdminLifecycleMutations } from "@/hooks/useAdminInvitations";
import { useUserAccessHistory } from "@/hooks/useAccessHistory";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, Shield, Trash2, User, UserX, UserCheck, AlertTriangle, Info } from "lucide-react";
import AddWorkspaceAccessDialog from "@/components/admin/AddWorkspaceAccessDialog";
import { AccessHistorySection } from "@/components/admin/AccessHistorySection";
import { ProjectAccessSection } from "@/components/admin/ProjectAccessSection";
import { useProjectAccessMutations } from "@/hooks/useProjectAccessAdmin";
import { useToast } from "@/hooks/use-toast";

const WORKSPACE_ROLES = [
  { value: "workspace_admin", label: "Workspace Admin" },
  { value: "project_manager", label: "Project Manager" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" },
];

function formatRole(role: string | null) {
  if (!role) return "—";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminUserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const { organizationId } = useOutletContext<{ organizationId: string }>();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { data: detail, isLoading, error } = useAdminUserDetail(organizationId, userId);
  const mutations = useAdminUserMutations(organizationId, userId);
  const lifecycle = useAdminLifecycleMutations(organizationId, userId);
  const { data: accessHistory = [], isLoading: historyLoading } = useUserAccessHistory(organizationId, userId);
  const [addWsOpen, setAddWsOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/users"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Users</Link>
        </Button>
        <div className="py-8 text-center text-sm text-destructive">
          {(error as Error).message}
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const isSelf = currentUser?.id === detail.user_id;
  const existingWsIds = detail.workspaces.map((w) => w.workspace_id);

  // Build actor name map from current user for history display
  const actorNames: Record<string, string> = {};
  if (currentUser?.id) {
    actorNames[currentUser.id] = "You";
  }
  if (detail.user_id && detail.display_name) {
    actorNames[detail.user_id] = detail.display_name;
  }

  /** Handle role change with server error surfacing */
  const handleWorkspaceRoleChange = (workspaceId: string, newRole: string) => {
    mutations.changeWorkspaceRole.mutate(
      { workspaceId, newRole },
      {
        onError: (err: Error) => {
          toast({
            title: "Cannot change role",
            description: err.message.includes("last workspace admin")
              ? "This user is the last Workspace Admin in this workspace. Assign another Workspace Admin first."
              : err.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  /** Handle workspace access removal with server error surfacing */
  const handleRemoveWorkspaceAccess = (workspaceId: string) => {
    mutations.removeWorkspaceAccess.mutate(workspaceId, {
      onError: (err: Error) => {
        toast({
          title: "Cannot remove access",
          description: err.message.includes("last workspace admin")
            ? "This user is the last Workspace Admin in this workspace. Assign another Workspace Admin first."
            : err.message,
          variant: "destructive",
        });
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Button variant="ghost" size="sm" asChild>
        <Link to="/admin/users"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Users</Link>
      </Button>

      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-muted-foreground" />
            {detail.display_name || "Unnamed User"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Email:</span> {detail.email}</p>
          <p>
            <span className="text-muted-foreground">Status:</span>{" "}
            {detail.is_active !== false ? (
              <Badge variant="default">Active</Badge>
            ) : (
              <Badge variant="destructive">Deactivated</Badge>
            )}
          </p>
          <p><span className="text-muted-foreground">Member since:</span> {new Date(detail.created_at).toLocaleDateString()}</p>
        </CardContent>
      </Card>

      {/* Organization Role */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5 text-muted-foreground" />
            Organization Role
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Organization Admin is an org-wide authority role, separate from workspace participation. Org Admins can manage all users, workspaces, and invitations.
          </p>
          <div className="flex items-center gap-3">
            <Switch
              checked={detail.is_org_admin}
              disabled={isSelf || mutations.setOrgAdmin.isPending}
              onCheckedChange={(checked) => {
                mutations.setOrgAdmin.mutate(checked, {
                  onError: (err: Error) => {
                    toast({
                      title: "Cannot change org admin status",
                      description: err.message.includes("Cannot remove your own")
                        ? "You cannot remove your own Organization Admin role."
                        : err.message.includes("last organization admin")
                        ? "This is the last Organization Admin. At least one must remain."
                        : err.message,
                      variant: "destructive",
                    });
                  },
                });
              }}
            />
            <span className="text-sm font-medium">
              {detail.is_org_admin ? "Organization Admin" : "No org-wide admin role"}
            </span>
          </div>
          {isSelf && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>You cannot change your own Organization Admin status. Another Organization Admin must do this.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workspace Access */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Workspace Access</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Workspace roles control access within each workspace, separate from the organization-wide role above.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAddWsOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Access
          </Button>
        </CardHeader>
        <CardContent>
          {detail.workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              This user has no workspace memberships.
            </p>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Workspace Role</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.workspaces.map((ws) => (
                    <TableRow key={ws.workspace_id}>
                      <TableCell className="font-medium">{ws.workspace_name}</TableCell>
                      <TableCell>
                        <Select
                          value={ws.role || "viewer"}
                          onValueChange={(newRole) => handleWorkspaceRoleChange(ws.workspace_id, newRole)}
                          disabled={mutations.changeWorkspaceRole.isPending}
                        >
                          <SelectTrigger className="w-[180px] h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WORKSPACE_ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove workspace access?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will remove {detail.display_name || "this user"}'s membership and workspace role in "{ws.workspace_name}". Their history and contributions are preserved.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => handleRemoveWorkspaceAccess(ws.workspace_id)}
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Project Access */}
      <ProjectAccessSection
        userId={detail.user_id}
        workspaces={detail.workspaces.map((w) => ({
          workspace_id: w.workspace_id,
          workspace_name: w.workspace_name,
          role: w.role,
        }))}
      />

      {/* Access Lifecycle */}
      {!isSelf && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {detail.is_active !== false ? (
                <UserX className="h-5 w-5 text-muted-foreground" />
              ) : (
                <UserCheck className="h-5 w-5 text-muted-foreground" />
              )}
              Access Lifecycle
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.is_active !== false ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Deactivating stops product access but preserves all history, comments, assignments, and contributions. This is reversible.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={lifecycle.deactivateUser.isPending}>
                      <UserX className="h-4 w-4 mr-1" /> Deactivate User
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Deactivate user access?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {detail.display_name || "This user"} will lose product access immediately. Their history, comments, assignments, and contributions are preserved. You can reactivate later.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => lifecycle.deactivateUser.mutate()}
                      >
                        Deactivate
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This user is deactivated. Reactivating will restore their product access with existing workspace memberships and roles.
                </p>
                <Button
                  variant="default"
                  size="sm"
                  disabled={lifecycle.reactivateUser.isPending}
                  onClick={() => lifecycle.reactivateUser.mutate()}
                >
                  <UserCheck className="h-4 w-4 mr-1" /> Reactivate User
                </Button>
              </>
            )}

            {/* Delete User - permanent action */}
            <div className="pt-4 mt-4 border-t">
              <p className="text-sm text-muted-foreground mb-2">
                Permanently remove this user from the organization. Historical records (comments, updates) are preserved with anonymized authorship. This cannot be undone.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive border-destructive hover:bg-destructive/10" disabled={lifecycle.deleteUser.isPending}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete User
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      Permanently delete user?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove {detail.display_name || detail.email} from the organization, including all workspace memberships and roles. Historical records are preserved with anonymized authorship. This action cannot be undone.
                      {detail.is_org_admin && (
                        <span className="block mt-2 font-medium text-destructive">
                          Note: If this user is the last Organization Admin, deletion will be blocked.
                        </span>
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => {
                        lifecycle.deleteUser.mutate(undefined, {
                          onSuccess: () => {
                            window.location.href = "/admin/users";
                          },
                          onError: (err: Error) => {
                            toast({
                              title: "Cannot delete user",
                              description: err.message.includes("last organization admin")
                                ? "This is the last Organization Admin. At least one must remain."
                                : err.message.includes("last workspace admin")
                                ? "This user is the last Workspace Admin in one or more workspaces. Reassign the Workspace Admin role first."
                                : err.message,
                              variant: "destructive",
                            });
                          },
                        });
                      }}
                    >
                      Delete Permanently
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Access History */}
      <AccessHistorySection
        events={accessHistory}
        isLoading={historyLoading}
        actorNames={actorNames}
        title="Recent Access Changes"
      />

      <AddWorkspaceAccessDialog
        open={addWsOpen}
        onOpenChange={setAddWsOpen}
        organizationId={organizationId}
        existingWorkspaceIds={existingWsIds}
        loading={mutations.addWorkspaceAccess.isPending}
        onSubmit={(workspaceId, role) => {
          mutations.addWorkspaceAccess.mutate(
            { workspaceId, role },
            {
              onSuccess: async () => {
                // PA-2: auto-grant inherited project access to all current non-archived projects
                try {
                  const { supabase } = await import("@/integrations/supabase/client");
                  await supabase.rpc("pa_grant_all_workspace_projects", {
                    _target_user_id: detail.user_id,
                    _workspace_id: workspaceId,
                    _override_role: null,
                  });
                } catch (e) {
                  // Non-fatal: workspace access still added
                  console.warn("pa_grant_all_workspace_projects failed", e);
                }
                setAddWsOpen(false);
              },
            }
          );
        }}
      />
    </div>
  );
}
