import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useAdminInvitations, useAdminInvitationMutations } from "@/hooks/useAdminInvitations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Mail, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import InviteUserDialog from "@/components/admin/InviteUserDialog";

function formatRole(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function InvitationStatusBadge({ status, isExpired }: { status: string; isExpired: boolean }) {
  if (status === "revoked") return <Badge variant="destructive">Revoked</Badge>;
  if (status === "accepted") return <Badge variant="default">Accepted</Badge>;
  if (isExpired) return <Badge variant="secondary">Expired</Badge>;
  if (status === "pending") return <Badge variant="outline">Pending</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export default function AdminInvitations() {
  const { organizationId } = useOutletContext<{ organizationId: string }>();
  const { data: invitations, isLoading, error } = useAdminInvitations(organizationId);
  const mutations = useAdminInvitationMutations(organizationId);
  const [inviteOpen, setInviteOpen] = useState(false);

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
        Failed to load invitations: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {invitations?.length || 0} invitation(s)
        </p>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Invite User
        </Button>
      </div>

      {!invitations?.length ? (
        <div className="flex flex-col items-center py-16 space-y-3">
          <Mail className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No invitations yet.</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((inv) => {
                const canResend = inv.status === "pending";
                const canRevoke = inv.status === "pending";
                const canDelete = inv.status !== "accepted";
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <InvitationStatusBadge status={inv.status} isExpired={inv.is_expired} />
                    </TableCell>
                    <TableCell>{formatRole(inv.role)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.workspace_name || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(inv.invited_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {canResend && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Resend"
                            disabled={mutations.resendInvitation.isPending}
                            onClick={() => mutations.resendInvitation.mutate({ invitationId: inv.id, email: inv.email })}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        {canRevoke && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Revoke"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will revoke the pending invitation for {inv.email}. They will no longer be able to accept it.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => mutations.revokeInvitation.mutate(inv.id)}
                                >
                                  Revoke
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        {canDelete && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete invitation?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete the invitation for {inv.email}. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => mutations.deleteInvitation.mutate(inv.id)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        organizationId={organizationId}
        loading={mutations.createInvitation.isPending}
        onSubmit={(email) => {
          mutations.createInvitation.mutate(
            { email },
            { onSuccess: () => setInviteOpen(false) }
          );
        }}
      />
    </div>
  );
}
